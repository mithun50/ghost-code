import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { askNoul, healthy, noulProbability, type LayaEndpoint } from '../src/client.ts'
import { DecisionLog } from '../src/decisions.ts'
import { decideCommand, decideStop, isCommandTool, textOf, type Ask } from '../src/hooks.ts'

let server: Server
let endpoint: LayaEndpoint
let nextAnswer: unknown = { noul: 0.2 }
let delayMs = 0

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer k') { response.writeHead(401).end(); return }
    if (request.url === '/health') { response.writeHead(200).end('{"ok":true}'); return }
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { questions: Record<string, { type: string }> }
      expect(parsed.questions['q']?.type).toBe('noul')
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ answers: { q: nextAnswer } }))
      }, delayMs)
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  endpoint = { baseURL: `http://127.0.0.1:${port}`, apiKey: 'k' }
})

afterAll(async () => { await new Promise((resolve) => { server.close(resolve) }) })

describe('laya client', () => {
  it('reads both noul answer shapes', () => {
    expect(noulProbability({ noul: 0.7 })).toBe(0.7)
    expect(noulProbability({ probabilities: { yes: 0.4, no: 0.6 } })).toBe(0.4)
    expect(noulProbability({ choice: 'x' })).toBeUndefined()
  })

  it('asks the sidecar and reports latency', async () => {
    nextAnswer = { noul: 0.9 }
    delayMs = 0
    const outcome = await askNoul(endpoint, 'state', { type: 'noul', instructions: 'done?' }, 2000)
    expect(outcome.probability).toBe(0.9)
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0)
    expect(await healthy(endpoint)).toBe(true)
  })

  it('abstains on timeout and bad keys instead of throwing', async () => {
    delayMs = 300
    const slow = await askNoul(endpoint, 's', { type: 'noul', instructions: 'q' }, 50)
    expect(slow.probability).toBeUndefined()
    expect(slow.error).toMatch(/timed out/)
    delayMs = 0
    const denied = await askNoul({ ...endpoint, apiKey: 'wrong' }, 's', { type: 'noul', instructions: 'q' }, 2000)
    expect(denied.error).toMatch(/401/)
  })
})

describe('laya hooks', () => {
  const ask = (probability: number | undefined): Ask => async () =>
    probability === undefined ? { latencyMs: 5, error: 'x' } : { probability, latencyMs: 5 }

  it('continues an unfinished turn once', async () => {
    expect((await decideStop(ask(0.2), 's', 0.5, false))?.action).toBe('continue')
    expect((await decideStop(ask(0.8), 's', 0.5, false))?.action).toBe('stop')
    expect(await decideStop(ask(0.2), 's', 0.5, true)).toBeUndefined()
    expect((await decideStop(ask(undefined), 's', 0.5, false))?.action).toBe('abstain')
  })

  it('does nothing when the sidecar is off', async () => {
    const off: Ask = async () => undefined
    expect(await decideStop(off, 's', 0.5, false)).toBeUndefined()
    expect(await decideCommand(off, 'bash ls', 'out', 0.3)).toBeUndefined()
  })

  it('flags failed commands', async () => {
    expect((await decideCommand(ask(0.1), 'bash x', 'error', 0.3))?.action).toBe('flag-failure')
    expect((await decideCommand(ask(0.9), 'bash x', 'ok', 0.3))?.action).toBe('pass')
    expect(isCommandTool('bash')).toBe(true)
    expect(isCommandTool('read_file')).toBe(false)
  })

  it('extracts text blocks only', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })
})

describe('decision log', () => {
  it('buffers and appends JSONL', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'laya-')), 'decisions.jsonl')
    const log = new DecisionLog(file)
    log.record({ time: 1, hook: 'turn-stopping', question: 'q', probability: 0.3, latencyMs: 9, action: 'continue' })
    log.record({ time: 2, hook: 'post-execute', question: 'q', latencyMs: 4, action: 'abstain' })
    await log.flush()
    expect(log.count).toBe(2)
    expect(log.recent(1)[0]?.action).toBe('abstain')
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { action: string })
    expect(lines.map(line => line.action)).toEqual(['continue', 'abstain'])
  })
})
