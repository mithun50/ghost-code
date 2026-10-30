import { describe, expect, it } from 'vitest'
import { LITE_TOOLS, LOCAL_PROMPT, slimDescription, slimTools } from '../src/local-prompt.ts'

const tool = (name: string, description: string) => ({ name, description, parameters: { type: 'object', properties: {} } })

describe('local prompt', () => {
  it('is short enough to read in about a second on a laptop', () => {
    expect(LOCAL_PROMPT.length).toBeLessThan(900)
    expect(LOCAL_PROMPT).toContain('GhostCode')
  })

  it('cuts a long description at a sentence end, deterministically', () => {
    const long = `${'Run a PowerShell command in the workspace and return its output. '.repeat(8)}\n\nMore detail here.`
    const short = slimDescription(long)
    expect(short.length).toBeLessThanOrEqual(280)
    expect(short.endsWith('.')).toBe(true)
    expect(slimDescription(long)).toBe(short)
    expect(slimDescription('Read a file.')).toBe('Read a file.')
  })

  it('keeps only lite tools and leaves their parameters intact', () => {
    const out = slimTools([tool('pwsh', 'x '.repeat(400)), tool('web_search', 'search'), tool('create_goal', 'goal'), tool('read', 'Read a file.')])
    expect(out.map(t => t.name)).toEqual(['pwsh', 'read'])
    expect(out[0]?.parameters).toEqual({ type: 'object', properties: {} })
    expect(out.every(t => LITE_TOOLS.includes(t.name))).toBe(true)
  })

  it('falls back to every tool when none is a lite tool', () => {
    expect(slimTools([tool('custom', 'A tool.')]).map(t => t.name)).toEqual(['custom'])
  })
})
