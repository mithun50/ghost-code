/** Install pinned models and run one llama.cpp server that lives and dies with the Host. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { catalogModel, LLAMA_BUILD, modelUrl, runtimeAsset, type CatalogModel } from './catalog.ts'
import { downloadFile } from './download.ts'
import type { DownloadProgress } from './types.ts'

/** Loading a model from disk takes seconds; slow disks get generous room. */
const READY_TIMEOUT_MS = 180_000
const BENCH_PROMPT = 'Write a TypeScript function that returns the sum of an array of numbers.'

interface Logger { info(message: string): void; warn(message: string): void }

/**
 * Kill a child and everything it started.
 * @param pid - process id.
 */
function killPid(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try { process.kill(pid) } catch { /* already gone */ }
  }
}

/** Whether a TCP port on loopback is free. */
async function portFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => { resolve(false) })
    probe.listen(port, '127.0.0.1', () => { probe.close(() => { resolve(true) }) })
  })
}

/** Run one command to completion. */
async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => { code === 0 ? resolve() : reject(new Error(`${command} exited with code ${String(code)}`)) })
  })
}

/** Server lifecycle as the browser sees it. */
export interface ServerState {
  state: 'stopped' | 'starting' | 'running' | 'error'
  model?: string
  phase?: string
  error?: string
}

/** Owns `<home>/local-models`: the llama.cpp build, the GGUF files and the server. */
export class LocalModelManager {
  runtimeProgress: DownloadProgress | undefined
  runtimeError: string | undefined
  readonly downloads = new Map<string, DownloadProgress>()
  readonly errors = new Map<string, string>()
  server: ServerState = { state: 'stopped' }
  /** Measured tokens per second by model id, kept across restarts. */
  measured: Record<string, number>
  private child: ChildProcess | undefined
  private starting: Promise<void> | undefined
  private startingModel: string | undefined
  private runtimeJob: Promise<void> | undefined

  constructor(readonly root: string, readonly port: number, private readonly logger: Logger) {
    this.measured = this.readMeasured()
    this.reapStale()
  }

  get modelsDir(): string { return join(this.root, 'models') }
  private get runtimeDir(): string { return join(this.root, 'bin', `${LLAMA_BUILD}-${runtimeAsset()?.key ?? 'none'}`) }
  private get serverExe(): string { return join(this.runtimeDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server') }
  private get pidFile(): string { return join(this.root, 'server.pid') }
  private get stateFile(): string { return join(this.root, 'measured.json') }
  private get slotsDir(): string { return join(this.root, 'slots') }
  /** OpenAI-compatible base URL of the server. */
  get baseURL(): string { return `http://127.0.0.1:${String(this.port)}/v1` }

  modelPath(model: CatalogModel): string { return join(this.modelsDir, model.file) }
  installed(model: CatalogModel): boolean { return existsSync(this.modelPath(model)) }
  runtimeReady(): boolean { return existsSync(this.serverExe) }
  runtimeBusy(): boolean { return this.runtimeJob !== undefined }

  private readMeasured(): Record<string, number> {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf8')) as unknown
      if (parsed === null || typeof parsed !== 'object') return {}
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))) as Record<string, number>
    } catch {
      return {}
    }
  }

  /** Kill a server an earlier Host left running after a crash. */
  private reapStale(): void {
    let pid: number
    try { pid = Number(readFileSync(this.pidFile, 'utf8').trim()) } catch { return }
    rmSync(this.pidFile, { force: true })
    if (!Number.isInteger(pid) || pid <= 0) return
    // Only kill the pid when it is still a llama-server, not a reused number.
    if (process.platform === 'win32') {
      const listing = spawnSync('tasklist', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })
      if (!/llama-server/i.test(listing.stdout ?? '')) return
    } else {
      const listing = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' })
      if (!/llama-server/.test(listing.stdout ?? '')) return
    }
    this.logger.warn(`local-models: stopping a llama-server left from an earlier run (pid ${String(pid)})`)
    killPid(pid)
  }

  /** Download and unpack llama.cpp once; concurrent installs share the job. */
  async ensureRuntime(): Promise<void> {
    if (this.runtimeReady()) return
    this.runtimeJob ??= this.fetchRuntime().finally(() => { this.runtimeJob = undefined })
    await this.runtimeJob
  }

  private async fetchRuntime(): Promise<void> {
    const found = runtimeAsset()
    if (found === undefined) throw new Error(`no llama.cpp build for ${process.platform}-${process.arch}`)
    const { asset, url } = found
    this.runtimeError = undefined
    try {
      const archive = join(this.root, 'bin', asset.name)
      await downloadFile({ url, path: archive, size: asset.size, sha256: asset.sha256 },
        (done) => { this.runtimeProgress = { done, total: asset.size } })
      rmSync(this.runtimeDir, { recursive: true, force: true })
      mkdirSync(this.runtimeDir, { recursive: true })
      // Windows 10+ ships bsdtar, which reads zip archives.
      const tar = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
      await run(tar, ['-xf', archive, '-C', this.runtimeDir, ...asset.nested ? ['--strip-components=1'] : []])
      rmSync(archive, { force: true })
      if (!this.runtimeReady()) throw new Error('llama.cpp was downloaded but llama-server was not found in it')
    } catch (error: unknown) {
      this.runtimeError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.runtimeProgress = undefined
    }
  }

  /**
   * Download llama.cpp and one model, then start the server on it.
   * @param id - catalog id.
   */
  async install(id: string): Promise<void> {
    const model = catalogModel(id)
    if (model === undefined) throw new Error(`unknown model ${id}`)
    if (this.downloads.has(id)) return
    this.errors.delete(id)
    // The draft model downloads with its main model, so one click gets the faster setup.
    const draft = model.draft === undefined ? undefined : catalogModel(model.draft)
    const files = draft === undefined ? [model] : [model, draft]
    const total = files.reduce((sum, file) => sum + file.size, 0)
    this.downloads.set(id, { done: 0, total })
    try {
      await this.ensureRuntime()
      let finished = 0
      for (const file of files) {
        await downloadFile({ url: modelUrl(file), path: this.modelPath(file), size: file.size, sha256: file.sha256 },
          (done) => { this.downloads.set(id, { done: finished + done, total }) })
        finished += file.size
      }
    } catch (error: unknown) {
      this.errors.set(id, error instanceof Error ? error.message : String(error))
      return
    } finally {
      this.downloads.delete(id)
    }
    await this.start(id)
  }

  /**
   * Make the server run `id`. A no-op when it already does; concurrent calls
   * for the same model share one start.
   * @param id - catalog id.
   */
  async start(id: string): Promise<void> {
    if (this.server.state === 'running' && this.server.model === id && this.child !== undefined) return
    if (this.starting !== undefined && this.startingModel === id) { await this.starting; return }
    if (this.starting !== undefined) await this.starting.catch(() => {})
    this.startingModel = id
    this.starting = this.launch(id).finally(() => { this.starting = undefined; this.startingModel = undefined })
    await this.starting
  }

  private async launch(id: string): Promise<void> {
    const model = catalogModel(id)
    if (model === undefined || !this.installed(model)) {
      this.server = { state: 'error', model: id, error: `${id} is not installed` }
      return
    }
    this.stop()
    this.server = { state: 'starting', model: id, phase: `Loading ${model.name}` }
    try {
      await this.ensureRuntime()
      // A just-killed server can hold the port for a few seconds on Windows; wait before giving up.
      if (!await this.waitForPort(15_000)) throw new Error(`port ${String(this.port)} is already in use; set localModels.port to a free port`)
      // The GPU build falls back to the CPU when a driver refuses it.
      const ready = await this.spawnServer(model, []) || await this.spawnServer(model, ['--device', 'none'])
      if (!ready) throw new Error(`llama-server could not load ${model.name}. See ${join(this.root, 'llama-server.log')}`)
      // Measure once per model; later starts skip straight to serving.
      let tps = this.measured[id]
      if (tps === undefined) {
        this.server = { state: 'running', model: id, phase: 'Measuring speed' }
        tps = await this.benchmark()
        if (tps !== undefined) {
          this.measured = { ...this.measured, [id]: tps }
          writeFileSync(this.stateFile, JSON.stringify(this.measured, null, 2))
        }
      }
      this.warmSaved = await this.restoreWarm(id)
      this.server = { state: 'running', model: id }
      this.logger.info(`local-models: ${model.name} is running at ${this.baseURL}${tps === undefined ? '' : ` (${String(tps)} tok/s)`}`)
    } catch (error: unknown) {
      this.stop()
      this.server = { state: 'error', model: id, error: error instanceof Error ? error.message : String(error) }
      this.logger.warn(`local-models: ${this.server.error ?? ''}`)
    }
  }

  /** Poll until the server port is free, up to `timeoutMs`. */
  private async waitForPort(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await portFree(this.port)) return true
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    return await portFree(this.port)
  }

  /** Start llama-server and wait for `/health`; false when it exits or never becomes ready. */
  private async spawnServer(model: CatalogModel, extra: string[]): Promise<boolean> {
    mkdirSync(this.root, { recursive: true })
    // llama-server rejects --slot-save-path when the folder is missing.
    mkdirSync(this.slotsDir, { recursive: true })
    const log = openSync(join(this.root, 'llama-server.log'), 'a')
    const draft = model.draft === undefined ? undefined : catalogModel(model.draft)
    const drafting = draft !== undefined && this.installed(draft)
    const cpuOnly = extra.includes('--device')
    let child: ChildProcess
    try {
      child = spawn(this.serverExe, [
        '-m', this.modelPath(model),
        '--host', '127.0.0.1',
        '--port', String(this.port),
        '-c', String(model.contextWindow),
        '-np', '1',
        '--jinja',
        '--no-webui',
        '-a', model.id,
        // Thinking costs a small model most of its tokens on routine tool steps.
        '--chat-template-kwargs', '{"enable_thinking":false}',
        // Keep the whole model on the GPU when there is one; quantized KV halves cache memory.
        ...cpuOnly ? [] : ['-ngl', '99'],
        '-fa', 'auto',
        '-ctk', 'q8_0',
        '-ctv', 'q8_0',
        // Reuse the cached prompt prefix across turns so later replies start fast.
        '--cache-reuse', '256',
        '--slot-save-path', this.slotsDir,
        ...drafting ? ['-md', this.modelPath(draft), ...cpuOnly ? [] : ['-ngld', '99']] : [],
        ...extra,
      ], { cwd: this.runtimeDir, windowsHide: true, stdio: ['ignore', log, log] })
    } finally {
      closeSync(log)
    }
    this.child = child
    if (child.pid !== undefined) writeFileSync(this.pidFile, String(child.pid))
    const onHostExit = (): void => { if (child.pid !== undefined) killPid(child.pid) }
    process.once('exit', onHostExit)
    let exited = false
    child.once('error', (error) => { exited = true; this.logger.warn(`local-models: ${error.message}`) })
    child.once('exit', (code) => {
      exited = true
      process.off('exit', onHostExit)
      if (this.child !== child) return
      this.child = undefined
      rmSync(this.pidFile, { force: true })
      if (this.server.state === 'running') {
        this.server = { state: 'error', ...this.server.model === undefined ? {} : { model: this.server.model }, error: `llama-server stopped (exit code ${String(code)})` }
      }
    })
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline && !exited && this.child === child) {
      try {
        const response = await fetch(`http://127.0.0.1:${String(this.port)}/health`, { signal: AbortSignal.timeout(2000) })
        if (response.ok) return true
      } catch { /* still loading */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (this.child === child) this.stop()
    return false
  }

  /** Whether this server run already has its prompt cache on disk. */
  warmSaved = false

  private warmFile(id: string): string { return `${id}.slot` }

  /**
   * Save slot 0's prompt cache so the next start skips re-reading the system prompt.
   * Safe to call repeatedly; only the first call per server run writes.
   */
  async saveWarm(): Promise<void> {
    const id = this.server.model
    if (this.warmSaved || id === undefined || this.server.state !== 'running') return
    this.warmSaved = true
    try {
      mkdirSync(this.slotsDir, { recursive: true })
      await fetch(`http://127.0.0.1:${String(this.port)}/slots/0?action=save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: this.warmFile(id) }), signal: AbortSignal.timeout(30_000),
      })
    } catch { /* a cold start next time is the only cost */ }
  }

  /** Restore a saved prompt cache; false when there is none or the build refuses it. */
  private async restoreWarm(id: string): Promise<boolean> {
    if (!existsSync(join(this.slotsDir, this.warmFile(id)))) return false
    try {
      const response = await fetch(`http://127.0.0.1:${String(this.port)}/slots/0?action=restore`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: this.warmFile(id) }), signal: AbortSignal.timeout(30_000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Generate a few tokens and read llama.cpp's own speed figure. */
  private async benchmark(): Promise<number | undefined> {
    try {
      const response = await fetch(`http://127.0.0.1:${String(this.port)}/completion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: BENCH_PROMPT, n_predict: 64, cache_prompt: false }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) return undefined
      const body = await response.json() as { timings?: { predicted_per_second?: number } }
      const tps = body.timings?.predicted_per_second
      return typeof tps === 'number' && Number.isFinite(tps) ? Math.round(tps * 10) / 10 : undefined
    } catch {
      return undefined
    }
  }

  /** Stop the server and its process tree. */
  stop(): void {
    const child = this.child
    this.child = undefined
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) killPid(child.pid)
    rmSync(this.pidFile, { force: true })
    if (this.server.state !== 'error') this.server = { state: 'stopped' }
  }

  /**
   * Delete a model's file, stopping the server first when it serves that model.
   * @param id - catalog id.
   */
  remove(id: string): void {
    const model = catalogModel(id)
    if (model === undefined) return
    if (this.server.model === id) { this.stop(); this.server = { state: 'stopped' } }
    rmSync(this.modelPath(model), { force: true })
    rmSync(`${this.modelPath(model)}.part`, { force: true })
    this.errors.delete(id)
  }
}
