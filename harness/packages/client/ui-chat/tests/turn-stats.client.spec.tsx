// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTurnStats } from '../src/client/conversation-nodes/turn-stats.ts'
import { TurnUsagePanel, turnSummary } from '../src/client/chat/TurnUsagePanel.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

let seq = 0
function event(type: string, time: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq: seq++, time, data } as unknown as SessionEvent
}

const textRun = (time0: number) => ({ type: 'text-chunks', time0, index: 0, dt: [0], texts: ['hi'] })

describe('deriveTurnStats', () => {
  it('times every attempt, counts retries as API calls, and measures first-token latency', () => {
    const events = [
      event('turn/start', 1_000, { turn: 1 }),
      event('step/start', 1_100, { turn: 1, step: 1 }),
      event('assistant/message', 2_100, { turn: 1, step: 1, stream: [textRun(1_400)], message: {} }),
      event('tool/call', 2_150, { turn: 1, step: 1, callId: 'a', name: 'shell', arguments: '{}' }),
      event('step/end', 2_500, { turn: 1, step: 1 }),
      event('step/start', 2_600, { turn: 1, step: 2 }),
      event('llm/retry', 2_700, { turn: 1, step: 2 }),
      event('llm/retry-started', 3_000, { turn: 1, step: 2 }),
      event('assistant/message', 4_000, { turn: 1, step: 2, stream: [textRun(3_200)], message: {} }),
      event('step/end', 4_100, { turn: 1, step: 2 }),
      event('turn/end', 4_200, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const stats = deriveTurnStats(events, 210)
    expect(stats).toEqual({
      durationMs: 3_200,
      apiCalls: 3,
      toolCalls: 1,
      // 1000 (step 1) + 100 (failed attempt) + 1000 (retry)
      modelMs: 2_100,
      outputTokensPerSecond: 100,
      ttftMs: 300,
    })
  })

  it('omits model time and speed when an attempt is untimed, and needs both turn bounds', () => {
    const untimed = deriveTurnStats([
      event('turn/start', 0, { turn: 2 }),
      event('assistant/attempt', 500, { turn: 2, step: 1, stream: [] }),
      event('turn/end', 900, { turn: 2, reason: { kind: 'completed' } }),
    ], 40)
    expect(untimed).toEqual({ durationMs: 900, apiCalls: 1, toolCalls: 0 })
    expect(deriveTurnStats([event('turn/start', 0, { turn: 3 })])).toBeUndefined()
  })
})

describe('turn stats row', () => {
  const usage = { uncachedInputTokens: 1_200, outputTokens: 340, totalTokens: 1_540 }
  const stats = { durationMs: 12_400, apiCalls: 3, toolCalls: 2, modelMs: 7_550, outputTokensPerSecond: 45.03 }

  it('joins the known segments with a middle dot', () => {
    expect(turnSummary(usage, stats, t).join(' · ')).toBe('12.4s · 3 calls · 2 tools · 1.2K in · 340 out · 45.0 tok/s')
    expect(turnSummary(undefined, { durationMs: 850, apiCalls: 1, toolCalls: 0 }, t)).toEqual(['850 ms', '1 call'])
  })

  it('renders timing even when the provider reported no usage, with details in the dialog', () => {
    const view = render(<TurnUsagePanel stats={{ durationMs: 65_000, apiCalls: 1, toolCalls: 1, modelMs: 2_000 }} t={t} />)
    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('1m 05s · 1 call · 1 tool')
    fireEvent.click(trigger)
    const details = view.getByRole('dialog').querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details.textContent).toContain('Time taken1m 05s')
    expect(details.textContent).toContain('Model time2.0s')
    expect(details.textContent).toContain('API calls1')
    expect(details.textContent).toContain('Tool calls1')
    expect(details.textContent).not.toContain('Uncached input')
  })

  it('renders nothing without usage or stats', () => {
    const view = render(<TurnUsagePanel t={t} />)
    expect(view.container.textContent).toBe('')
  })
})
