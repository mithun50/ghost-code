import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TurnStats } from '../contract/chat-nodes.ts'

type AttemptStream = Extract<SessionEvent, { type: 'assistant/message' }>['data']['stream']

/** Earliest durable content-chunk timestamp in one attempt's stream, if any chunk was recorded. */
function firstContentTime(stream: AttemptStream): number | undefined {
  let first: number | undefined
  for (const record of stream) {
    if (record.type === 'chunk') continue
    if (first === undefined || record.time0 < first) first = record.time0
  }
  return first
}

/**
 * Derive provider-independent timing and call counts for one completed Turn
 * from its durable Session events. An attempt opens at `step/start` or
 * `llm/retry-started` and settles at its `assistant/message`,
 * `assistant/attempt`, or an `llm/retry` that closes it without a record.
 * Model time and output speed are reported only when every attempt was timed.
 * @param events - the Turn's Session events, `turn/start` through `turn/end`.
 * @param outputTokens - exact provider-reported output tokens for the Turn, when known.
 * @returns the stats, or undefined when the Turn has no start and end.
 */
export function deriveTurnStats(events: readonly SessionEvent[], outputTokens?: number): TurnStats | undefined {
  let turnStart: number | undefined
  let turnEnd: number | undefined
  let attemptStart: number | undefined
  let apiCalls = 0
  let timedCalls = 0
  let toolCalls = 0
  let modelMs = 0
  let ttftMs: number | undefined

  const settle = (time: number, stream?: AttemptStream): void => {
    apiCalls++
    if (attemptStart === undefined) return
    modelMs += Math.max(0, time - attemptStart)
    timedCalls++
    if (ttftMs === undefined && stream !== undefined) {
      const first = firstContentTime(stream)
      if (first !== undefined && first >= attemptStart) ttftMs = first - attemptStart
    }
    attemptStart = undefined
  }

  for (const event of events) {
    if (event.type === 'turn/start') turnStart = event.time
    else if (event.type === 'turn/end') turnEnd = event.time
    else if (event.type === 'step/start' || event.type === 'llm/retry-started') attemptStart = event.time
    else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') settle(event.time, event.data.stream)
    else if (event.type === 'llm/retry') {
      if (attemptStart !== undefined) settle(event.time)
    } else if (event.type === 'tool/call') toolCalls++
  }

  if (turnStart === undefined || turnEnd === undefined) return undefined
  const timed = apiCalls > 0 && timedCalls === apiCalls && modelMs > 0
  return {
    durationMs: Math.max(0, turnEnd - turnStart),
    apiCalls,
    toolCalls,
    ...timed ? { modelMs } : {},
    ...timed && outputTokens !== undefined && outputTokens > 0
      ? { outputTokensPerSecond: outputTokens / (modelMs / 1_000) }
      : {},
    ...ttftMs === undefined ? {} : { ttftMs },
  }
}
