import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadAll, downloadFile } from '../src/download.ts'

const body = Buffer.alloc(200_000, 7)
const digest = createHash('sha256').update(body).digest('hex')
let server: Server
let base = ''
/** When set, the server sends this many bytes of a full reply and then goes silent. */
let stallAfter: number | undefined
let ranges: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const range = request.headers.range
    ranges.push(range ?? '')
    const start = range === undefined ? 0 : Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
    const slice = body.subarray(start)
    if (range === undefined) response.writeHead(200, { 'content-length': String(body.length) })
    else response.writeHead(206, { 'content-length': String(slice.length), 'content-range': `bytes ${String(start)}-${String(body.length - 1)}/${String(body.length)}` })
    if (stallAfter !== undefined) {
      const cut = stallAfter
      stallAfter = undefined
      response.write(slice.subarray(0, cut))
      return
    }
    response.end(slice)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => { server.close(resolve) })
})

describe('downloadFile', () => {
  it('downloads, verifies and reports bytes', async () => {
    ranges = []
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    const seen: number[] = []
    await downloadFile({ url: `${base}/m`, path, size: body.length, sha256: digest }, (done) => { seen.push(done) })
    expect(readFileSync(path).equals(body)).toBe(true)
    expect(seen.at(-1)).toBe(body.length)
    expect(existsSync(`${path}.part`)).toBe(false)
  })

  it('resumes a stalled connection with a Range request', async () => {
    ranges = []
    stallAfter = 50_000
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    await downloadFile({ url: `${base}/m`, path, size: body.length, sha256: digest }, () => {}, { idleMs: 200, retryMs: 10 })
    expect(readFileSync(path).equals(body)).toBe(true)
    expect(ranges).toEqual(['', 'bytes=50000-'])
  })

  it('continues a .part file left by an earlier run', async () => {
    ranges = []
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    writeFileSync(`${path}.part`, body.subarray(0, 120_000))
    const seen: number[] = []
    await downloadFile({ url: `${base}/m`, path, size: body.length, sha256: digest }, (done) => { seen.push(done) })
    expect(seen[0]).toBe(120_000)
    expect(ranges).toEqual(['bytes=120000-'])
    expect(readFileSync(path).equals(body)).toBe(true)
  })

  it('deletes a file that fails its checksum', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    await expect(downloadFile({ url: `${base}/m`, path, size: body.length, sha256: '0'.repeat(64) }, () => {}))
      .rejects.toThrow(/checksum/)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.part`)).toBe(false)
  })

  it('skips a file that is already complete', async () => {
    ranges = []
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    writeFileSync(path, body)
    await downloadFile({ url: `${base}/m`, path, size: body.length }, () => {})
    expect(ranges).toEqual([])
  })

  it('fails with a resumable message after the last attempt', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'laya-dl-')), 'm.bin')
    await expect(downloadFile({ url: 'http://127.0.0.1:9/none', path, size: 10 }, () => {}, { attempts: 2, retryMs: 1 }))
      .rejects.toThrow(/resumes where it stopped/)
  })
})

describe('downloadAll', () => {
  it('reports combined progress across files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laya-dl-'))
    const seen: Array<[number, number]> = []
    await downloadAll([
      { url: `${base}/a`, path: join(dir, 'a.bin'), size: body.length },
      { url: `${base}/b`, path: join(dir, 'sub', 'b.bin'), size: body.length },
    ], (done, total) => { seen.push([done, total]) })
    expect(seen.at(-1)).toEqual([body.length * 2, body.length * 2])
    expect(seen.every(([done, total]) => done <= total)).toBe(true)
    expect(readFileSync(join(dir, 'sub', 'b.bin')).equals(body)).toBe(true)
  })
})
