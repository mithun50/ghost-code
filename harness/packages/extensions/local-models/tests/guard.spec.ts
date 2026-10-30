import { describe, expect, it } from 'vitest'
import { redactText, sensitiveTarget } from '../src/egress.ts'
import { cleanRequest, isLocalProvider, judgeCommand, SessionGuard } from '../src/guard.ts'

describe('redactText', () => {
  it('removes well-known key formats', () => {
    const text = [
      'OPENAI=sk-proj-' + 'abcdefghijklmnopqrstuvwxyz0123456789',
      'gh token ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789AB',
      'aws AKIA' + 'ABCDEFGHIJKLMNOP',
      'groq gsk_' + 'abcdefghijklmnopqrstuvwxyz012345',
    ].join('\n')
    const result = redactText(text)
    expect(result.text).not.toMatch(/sk-proj-abc|ghp_abc|AKIAABCD|gsk_abc/)
    expect(result.found).toEqual(expect.arrayContaining(['openai-key', 'github-token', 'aws-access-key', 'groq-key']))
  })

  it('removes private keys, URL passwords and assigned secrets', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n'
      + 'DATABASE_URL=postgres://admin:hunter2pass@db.local/app\n'
      + 'const apiKey = "a8f3k29dk3m4n5b6v7c8"\n'
      + '"client_secret": "Zx9vB7nM5kL3jH1gF2dS"'
    const result = redactText(text)
    expect(result.text).not.toContain('MIIEow')
    expect(result.text).not.toContain('hunter2pass')
    expect(result.text).not.toContain('a8f3k29dk3m4n5b6v7c8')
    expect(result.text).not.toContain('Zx9vB7nM5kL3jH1gF2dS')
    expect(result.text).toContain('postgres://admin:[REDACTED:password]@db.local/app')
  })

  it('leaves ordinary code alone', () => {
    const code = 'const token = getToken()\nfunction password(input: string) { return input }\nconst apiKey = process.env.API_KEY\nlet secret: string\nconst key = config.token'
    const result = redactText(code)
    expect(result.found).toEqual([])
    expect(result.text).toBe(code)
  })
})

describe('sensitiveTarget', () => {
  it('names secret files in paths and commands', () => {
    expect(sensitiveTarget({ file_path: 'C:/app/.env' })).toBe('.env')
    expect(sensitiveTarget({ file_path: './.env.local' })).toBe('.env.local')
    expect(sensitiveTarget({ command: 'cat ~/.ssh/id_rsa' })).toBeDefined()
    expect(sensitiveTarget({ command: 'type server.pem' })).toBe('server.pem')
    expect(sensitiveTarget({ path: 'config/credentials.json' })).toBe('credentials.json')
  })

  it('allows templates and ordinary files', () => {
    expect(sensitiveTarget({ file_path: '.env.example' })).toBeUndefined()
    expect(sensitiveTarget({ file_path: 'src/environment.ts' })).toBeUndefined()
    expect(sensitiveTarget({ command: 'npm run build' })).toBeUndefined()
    expect(sensitiveTarget(undefined)).toBeUndefined()
  })
})

describe('cleanRequest', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'Deploy with key sk-ant-' + 'abcdefghijklmnopqrstuvwxyz0123' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":".env"}' }] },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'STRIPE=sk_live_' + 'abcdefghijklmnop1234' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c2', name: 'read', arguments: '{"file_path":"src/app.ts"}' }] },
    { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'export const x = 1' }] },
  ]

  it('withholds secret-file results, redacts the rest and lists files', () => {
    const result = cleanRequest(messages, undefined)
    const sent = JSON.stringify(result.messages)
    expect(sent).not.toContain('sk-ant-abc')
    expect(sent).not.toContain('sk_live_abc')
    expect(sent).toContain('withheld by GhostCode')
    expect(sent).toContain('export const x = 1')
    expect(result.withheld).toEqual(['.env'])
    expect(result.files).toEqual(expect.arrayContaining(['.env', 'src/app.ts']))
    expect(result.bytes).toBeGreaterThan(0)
  })

  it('does not mutate the original request', () => {
    const before = JSON.stringify(messages)
    cleanRequest(messages, 'system with sk-ant-' + 'abcdefghijklmnopqrstuvwxyz0123')
    expect(JSON.stringify(messages)).toBe(before)
  })
})

describe('evidence', () => {
  it('fails on non-zero exit codes and failure output, passes on exit code 0', () => {
    expect(judgeCommand(false, 'built\n[exit code: 2]')).toEqual({ passed: false, reason: 'exit code 2' })
    expect(judgeCommand(false, 'src/a.ts(1,1): error TS2304: Cannot find name').passed).toBe(false)
    expect(judgeCommand(false, 'Tests: 2 failed, 5 passed').passed).toBe(false)
    expect(judgeCommand(true, 'anything').passed).toBe(false)
    expect(judgeCommand(false, 'vite built in 800ms\n[exit code: 0]')).toEqual({ passed: true, reason: 'exit code 0' })
  })

  it('counts consecutive failures and resets on a pass', () => {
    const guard = new SessionGuard()
    for (const passed of [false, false, true, false]) guard.record({ time: 0, tool: 'pwsh', passed, reason: '' })
    expect(guard.totals()).toMatchObject({ passed: 1, failed: 3, streak: 1 })
  })

  it('treats only loopback runtimes as local', () => {
    expect(isLocalProvider('ghostcode-local')).toBe(true)
    expect(isLocalProvider('ollama')).toBe(true)
    expect(isLocalProvider('groq')).toBe(false)
    expect(isLocalProvider(undefined)).toBe(false)
  })
})
