/**
 * Auto-continue: when a reply is cut off at the output token limit, the turn
 * keeps going on its own instead of ending with "Output token limit reached"
 * and waiting for the user to type "continue". Bounded per turn.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'

/** The message the model receives when its reply was cut off. */
export const CONTINUE_PROMPT = 'Your last reply was cut off at the output token limit. Continue exactly where it stopped. '
  + 'Do not repeat what you already wrote and do not start over.'

/** Default continues per turn. */
const DEFAULT_LIMIT = 3

/**
 * Continues allowed per turn: GHOSTCODE_AUTO_CONTINUE overrides, 0 turns it off.
 * @param raw - the environment value.
 * @returns a non-negative whole number.
 */
export function continueLimit(raw: string | undefined = process.env['GHOSTCODE_AUTO_CONTINUE']): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_LIMIT
}

/**
 * Whether a recorded assistant stream ended at the output token limit.
 * @param stream - the `stream` of an `assistant/message` event.
 * @returns true when its finish chunk reports `max-tokens`.
 */
export function cutOff(stream: unknown): boolean {
  if (!Array.isArray(stream)) return false
  return stream.some((record: unknown) => {
    const chunk = (record as { chunk?: { type?: unknown, reason?: { kind?: unknown } } } | null)?.chunk
    return chunk?.type === 'finish' && chunk.reason?.kind === 'max-tokens'
  })
}

/**
 * Install auto-continue. Runs before Laya's end-of-turn check; a stop it
 * continues is recorded in `continued` so Laya does not also nudge it.
 * @param ctx - Host context.
 * @param source - message source for the continue prompt.
 * @param continued - shared `session:turn` keys continued at the current stop.
 * @param limit - continues allowed per turn; 0 disables.
 */
export function installAutoContinue(ctx: Context, source: MessageSource, continued: Set<string>, limit = continueLimit()): void {
  if (limit <= 0) return
  /** Session id to the turn whose latest reply was cut off. */
  const cut = new Map<string, number>()
  /** `session:turn` to continues already sent. */
  const used = new Map<string, number>()

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message') return
    const id = String(session.id)
    if (cutOff(event.data.stream)) cut.set(id, event.data.turn)
    else if (cut.get(id) === event.data.turn) cut.delete(id)
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const id = String(agent.session.id)
    const key = `${id}:${String(turn)}`
    continued.delete(key)
    if (cut.get(id) !== turn) return
    cut.delete(id)
    const count = used.get(key) ?? 0
    if (count >= limit) return
    used.set(key, count + 1)
    continued.add(key)
    agent.steer(createUserMessage({ content: [{ type: 'text', text: CONTINUE_PROMPT }], source }))
  })
}
