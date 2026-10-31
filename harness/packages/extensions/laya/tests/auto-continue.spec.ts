import { describe, expect, it } from 'vitest'
import { CONTINUE_PROMPT, continueLimit, cutOff } from '../src/auto-continue.ts'

const finish = (kind: string) => ({ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind } } })

describe('auto-continue', () => {
  it('detects a reply cut off at the output token limit', () => {
    expect(cutOff([{ type: 'chunk', time: 0, chunk: { type: 'text-delta', index: 0, text: 'part' } }, finish('max-tokens')])).toBe(true)
  })

  it('ignores replies that finished normally or with tool calls', () => {
    expect(cutOff([finish('stop')])).toBe(false)
    expect(cutOff([finish('tool-calls')])).toBe(false)
    expect(cutOff([])).toBe(false)
    expect(cutOff(undefined)).toBe(false)
  })

  it('reads the per-turn limit from the environment', () => {
    expect(continueLimit(undefined)).toBe(3)
    expect(continueLimit('5')).toBe(5)
    expect(continueLimit('0')).toBe(0)
    expect(continueLimit('nope')).toBe(3)
  })

  it('asks the model to resume, not restart', () => {
    expect(CONTINUE_PROMPT).toMatch(/Continue exactly where it stopped/)
    expect(/[–—]/.test(CONTINUE_PROMPT)).toBe(false)
  })
})
