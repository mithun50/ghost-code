/** Resumable, checksum-verified HTTP downloads that report bytes as they land (same as dsh-laya). */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

/** One file to fetch. `size` is exact; `sha256` is checked when given. */
export interface DownloadFile {
  readonly url: string
  readonly path: string
  readonly size: number
  readonly sha256?: string
}

/** Tuning seams; tests shorten them. */
export interface DownloadOptions {
  /** Abort a connection that delivers nothing for this long, then resume. */
  readonly idleMs?: number
  /** Connection attempts before the download fails. */
  readonly attempts?: number
  /** Pause before attempt n is `retryMs * n`. */
  readonly retryMs?: number
  readonly signal?: AbortSignal
}

const IDLE_MS = 30_000
const ATTEMPTS = 6
const RETRY_MS = 2_000

function sizeOf(path: string): number {
  return existsSync(path) ? statSync(path).size : 0
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** One connection: continue `part` from its current length. */
async function fetchInto(file: DownloadFile, part: string, onBytes: (done: number) => void, options: DownloadOptions): Promise<void> {
  let start = sizeOf(part)
  if (start > file.size) { rmSync(part, { force: true }); start = 0 }
  if (start === file.size) return
  const idle = new AbortController()
  const signal = options.signal === undefined ? idle.signal : AbortSignal.any([idle.signal, options.signal])
  let timer = setTimeout(() => { idle.abort(new Error('the connection stalled')) }, options.idleMs ?? IDLE_MS)
  const touch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { idle.abort(new Error('the connection stalled')) }, options.idleMs ?? IDLE_MS)
  }
  try {
    const response = await fetch(file.url, {
      headers: start > 0 ? { range: `bytes=${String(start)}-` } : {},
      redirect: 'follow',
      signal,
    })
    if (response.status !== 200 && response.status !== 206) throw new Error(`HTTP ${String(response.status)}`)
    if (response.body === null) throw new Error('empty response body')
    // A server that ignores Range answers 200 with the whole file: start over.
    if (response.status === 200) start = 0
    const out = createWriteStream(part, { flags: start > 0 ? 'a' : 'w' })
    let done = start
    try {
      for await (const chunk of response.body) {
        touch()
        if (!out.write(chunk)) await new Promise<void>((resolve) => { out.once('drain', () => { resolve() }) })
        done += (chunk as Uint8Array).byteLength
        onBytes(done)
      }
    } finally {
      await new Promise<void>((resolve, reject) => { out.end((error?: Error | null) => { error ? reject(error) : resolve() }) })
    }
  } catch (error: unknown) {
    throw idle.signal.aborted ? idle.signal.reason as Error : error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download one file next to its final path as `<path>.part`, resuming across
 * stalls and restarts, then verify and rename it into place.
 * @param file - source, destination, exact size and optional digest.
 * @param onBytes - receives the bytes on disk so far.
 * @param options - stall, retry and cancel controls.
 */
export async function downloadFile(file: DownloadFile, onBytes: (done: number) => void, options: DownloadOptions = {}): Promise<void> {
  if (sizeOf(file.path) === file.size) { onBytes(file.size); return }
  mkdirSync(dirname(file.path), { recursive: true })
  const part = `${file.path}.part`
  onBytes(Math.min(sizeOf(part), file.size))
  const attempts = options.attempts ?? ATTEMPTS
  let failure: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fetchInto(file, part, onBytes, options)
      failure = undefined
      break
    } catch (error: unknown) {
      if (options.signal?.aborted === true) throw new Error('download cancelled')
      failure = error
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, (options.retryMs ?? RETRY_MS) * attempt))
    }
  }
  if (sizeOf(part) !== file.size) {
    throw new Error(`could not download ${basename(file.path)}: ${messageOf(failure)}. Check the connection and try again; the download resumes where it stopped.`)
  }
  if (file.sha256 !== undefined && await sha256Of(part) !== file.sha256) {
    rmSync(part, { force: true })
    throw new Error(`${basename(file.path)} failed its checksum and was deleted. Try again.`)
  }
  renameSync(part, file.path)
}

/**
 * Download several files in order, reporting combined bytes.
 * @param files - the files, fetched one after another.
 * @param onBytes - receives the combined bytes on disk and the combined total.
 * @param options - stall, retry and cancel controls.
 */
export async function downloadAll(
  files: readonly DownloadFile[],
  onBytes: (done: number, total: number) => void,
  options: DownloadOptions = {},
): Promise<void> {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  let finished = 0
  for (const file of files) {
    await downloadFile(file, (done) => { onBytes(finished + done, total) }, options)
    finished += file.size
  }
  onBytes(total, total)
}
