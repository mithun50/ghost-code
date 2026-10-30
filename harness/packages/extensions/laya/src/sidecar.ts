/** On-demand install and lifecycle of the local `laya-serve` sidecar. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { healthy, type LayaEndpoint } from './client.ts'
import { downloadAll, downloadFile } from './download.ts'
import type { LayaProgress, LayaState } from './types.ts'

/** CPU wheels keep the install near 700 MB instead of a multi-GB CUDA build. */
const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu'
/** The model is on disk before start, so readiness only waits for the load. */
const START_TIMEOUT_MS = 180_000
const MAX_RESTARTS = 3

/**
 * The English checkpoint, pinned so every install fetches the same bytes.
 * laya-serve would otherwise fetch it on first start with no progress, and its
 * default preload pulls all three checkpoints (about 2.2 GB).
 */
const MODEL_URL = 'https://huggingface.co/convaiinnovations/laya/resolve/7b928d828b7b0e022f929d9bd2e44165aa270148'
const MODEL_FILES: ReadonlyArray<{ name: string, size: number, sha256?: string }> = [
  { name: 'rl_agent_config.json', size: 745 },
  { name: 'encoder/config.json', size: 2083 },
  { name: 'tokenizer/tokenizer_config.json', size: 308 },
  { name: 'tokenizer/tokenizer.json', size: 3_583_228 },
  { name: 'model.safetensors', size: 842_609_210, sha256: '891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c' },
]

/** uv builds fetched when the machine has no `uv` on PATH. */
const UV_URL = 'https://github.com/astral-sh/uv/releases/download/0.13.6'
const UV_ASSETS: Readonly<Record<string, { name: string, size: number, sha256: string }>> = {
  'win32-x64': { name: 'uv-x86_64-pc-windows-msvc.zip', size: 15_239_500, sha256: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f' },
  'win32-arm64': { name: 'uv-aarch64-pc-windows-msvc.zip', size: 15_439_263, sha256: 'c2426c0c8e28b53d8c440e47a18d96ad4db51e159866c0e81435b196d7f0081c' },
  'darwin-arm64': { name: 'uv-aarch64-apple-darwin.tar.gz', size: 14_235_670, sha256: '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472' },
  'darwin-x64': { name: 'uv-x86_64-apple-darwin.tar.gz', size: 17_004_934, sha256: '63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02' },
  'linux-x64': { name: 'uv-x86_64-unknown-linux-gnu.tar.gz', size: 16_799_024, sha256: 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645' },
  'linux-arm64': { name: 'uv-aarch64-unknown-linux-gnu.tar.gz', size: 15_794_886, sha256: '229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d' },
}

interface Logger { info(message: string): void; warn(message: string): void }

/** Pick a free loopback port. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => { resolve(typeof address === 'object' && address !== null ? address.port : 0) })
    })
  })
}

/** Run one command, reporting the last output line as the phase. */
async function run(command: string, args: string[], onLine: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const feed = (chunk: Buffer): void => {
      const line = chunk.toString('utf8').split(/\r?\n/).map(part => part.trim()).filter(Boolean).at(-1)
      if (line !== undefined) onLine(line.slice(0, 160))
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.once('error', reject)
    child.once('exit', (code) => { code === 0 ? resolve() : reject(new Error(`${command} exited with code ${String(code)}`)) })
  })
}

/**
 * Kill a child and everything it started. On Windows a venv `python.exe` is a
 * launcher that starts the real interpreter, so killing the launcher alone
 * would leave the server running after GhostCode exits.
 * @param child - the process to end.
 */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill()
  }
}

/** Owns the venv and model under `<home>/laya` and the one running sidecar. */
export class LayaSidecar {
  state: LayaState
  phase: string | undefined
  progress: LayaProgress | undefined
  error: string | undefined
  endpoint: LayaEndpoint | undefined
  private child: ChildProcess | undefined
  private restarts = 0
  private wanted = false

  constructor(readonly root: string, private readonly logger: Logger) {
    this.state = this.installed() ? 'off' : 'not-installed'
  }

  private get venv(): string { return join(this.root, '.venv') }
  private get python(): string {
    return process.platform === 'win32' ? join(this.venv, 'Scripts', 'python.exe') : join(this.venv, 'bin', 'python')
  }
  private get server(): string {
    return process.platform === 'win32' ? join(this.venv, 'Scripts', 'laya-serve.exe') : join(this.venv, 'bin', 'laya-serve')
  }
  /** The checkpoint directory laya-serve loads instead of the Hub. */
  get modelDir(): string { return join(this.root, 'model') }
  private get bundledUv(): string { return join(this.root, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv') }

  /** Whether every checkpoint file finished downloading and passed its checks. */
  modelReady(): boolean {
    return MODEL_FILES.every(file => existsSync(join(this.modelDir, file.name)))
  }

  /** Whether the venv holds `laya-serve` and the checkpoint is on disk. */
  installed(): boolean { return existsSync(this.server) && this.modelReady() }

  /**
   * Install Laya: uv, the Python environment, the packages and the model.
   * Every step skips what an earlier, interrupted install already finished.
   * Only the user's Install click calls this.
   * @returns whether the install completed.
   */
  async install(): Promise<boolean> {
    if (this.state === 'installing') return false
    this.state = 'installing'
    this.error = undefined
    this.progress = undefined
    try {
      if (!existsSync(this.server)) {
        const uv = await this.ensureUv()
        if (!existsSync(this.python)) {
          this.phase = 'Creating Python environment'
          await run(uv, ['venv', '--clear', '--python', '3.12', this.venv], (line) => { this.phase = line })
        }
        this.phase = 'Installing Laya packages (about 700 MB)'
        this.progress = undefined
        await run(uv, ['pip', 'install', '--python', this.python, 'laya[serve]',
          '--extra-index-url', TORCH_CPU_INDEX, '--index-strategy', 'unsafe-best-match'],
        (line) => { this.phase = `Installing Laya packages: ${line}` })
        if (!existsSync(this.server)) throw new Error('the packages installed but laya-serve was not found')
      }
      this.phase = 'Downloading the Laya model'
      await downloadAll(
        MODEL_FILES.map(file => ({
          url: `${MODEL_URL}/${file.name}`,
          path: join(this.modelDir, file.name),
          size: file.size,
          ...file.sha256 === undefined ? {} : { sha256: file.sha256 },
        })),
        (done, total) => { this.progress = { done, total } },
      )
      this.state = 'off'
      this.phase = undefined
      this.progress = undefined
      return true
    } catch (error: unknown) {
      this.fail(`Install failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** Find uv on PATH, or download a pinned build into `<home>/laya/bin`. */
  private async ensureUv(): Promise<string> {
    if (existsSync(this.bundledUv)) return this.bundledUv
    this.phase = 'Looking for uv'
    if (spawnSync('uv', ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0) return 'uv'
    const asset = UV_ASSETS[`${process.platform}-${process.arch}`]
    if (asset === undefined) throw new Error(`no uv build for ${process.platform}-${process.arch}; install uv from https://docs.astral.sh/uv`)
    this.phase = 'Downloading uv'
    const bin = join(this.root, 'bin')
    const archive = join(bin, asset.name)
    await downloadFile({ url: `${UV_URL}/${asset.name}`, path: archive, size: asset.size, sha256: asset.sha256 },
      (done) => { this.progress = { done, total: asset.size } })
    this.progress = undefined
    // Windows 10+ ships bsdtar, which reads zip; the release tarballs nest uv in one folder.
    const tar = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    const args = process.platform === 'win32' ? ['-xf', archive, '-C', bin] : ['-xzf', archive, '-C', bin, '--strip-components=1']
    await run(tar, args, () => {})
    rmSync(archive, { force: true })
    if (!existsSync(this.bundledUv)) throw new Error('uv was downloaded but could not be unpacked')
    return this.bundledUv
  }

  /** Remove the venv and the model. The decision log stays. */
  uninstall(): void {
    this.stop()
    rmSync(this.venv, { recursive: true, force: true })
    rmSync(this.modelDir, { recursive: true, force: true })
    this.state = 'not-installed'
    this.phase = undefined
    this.progress = undefined
    this.error = undefined
  }

  /** Start the sidecar on loopback with a fresh port and key. */
  async start(): Promise<void> {
    if (!this.installed()) { this.state = 'not-installed'; return }
    if (this.state === 'on' || this.state === 'starting') return
    this.wanted = true
    this.state = 'starting'
    this.phase = 'Loading the Laya model'
    this.progress = undefined
    this.error = undefined
    const port = await freePort()
    const apiKey = randomBytes(24).toString('hex')
    const endpoint = { baseURL: `http://127.0.0.1:${port}`, apiKey }
    mkdirSync(this.root, { recursive: true })
    const log = openSync(join(this.root, 'laya-serve.log'), 'a')
    let child: ChildProcess
    try {
      child = spawn(this.python, ['-m', 'laya.serve'], {
        windowsHide: true,
        stdio: ['ignore', log, log],
        env: {
          ...process.env,
          LAYA_HOST: '127.0.0.1',
          LAYA_PORT: String(port),
          LAYA_API_KEY: apiKey,
          LAYA_DEVICE: 'cpu',
          LAYA_LOG_LEVEL: 'warning',
          // Serve only the downloaded English checkpoint, from disk, never the Hub.
          LAYA_EXTRA_MODELS: JSON.stringify({ english: this.modelDir }),
          LAYA_MODELS: 'english',
          LAYA_DEFAULT_MODEL: 'english',
          LAYA_MAX_LOADED: '1',
          LAYA_IDLE_UNLOAD_SECONDS: '600',
          HF_HOME: join(this.root, 'hf'),
          HF_HUB_OFFLINE: '1',
        },
      })
    } finally {
      closeSync(log)
    }
    this.child = child
    // A Host that exits without disposing still takes the sidecar down with it.
    const onHostExit = (): void => { killTree(child) }
    process.once('exit', onHostExit)
    child.once('exit', (code) => {
      process.off('exit', onHostExit)
      this.onExit(child, code)
    })
    child.once('error', (error) => { this.logger.warn(`laya: could not start the sidecar: ${error.message}`) })
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline && this.child === child) {
      if (await healthy(endpoint)) {
        this.endpoint = endpoint
        this.state = 'on'
        this.phase = undefined
        this.restarts = 0
        this.logger.info(`laya: sidecar ready on port ${String(port)}`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (this.child === child) {
      this.stop()
      this.fail(`Laya did not become ready in time. See ${join(this.root, 'laya-serve.log')}`)
    }
  }

  /** Stop the sidecar and its process tree; hooks become no-ops. */
  stop(): void {
    this.wanted = false
    const child = this.child
    this.child = undefined
    this.endpoint = undefined
    if (child !== undefined) killTree(child)
    if (this.state === 'on' || this.state === 'starting') this.state = 'off'
    this.phase = undefined
  }

  private onExit(child: ChildProcess, code: number | null): void {
    if (this.child !== child) return
    this.child = undefined
    this.endpoint = undefined
    if (!this.wanted) return
    if (this.restarts < MAX_RESTARTS) {
      this.restarts++
      this.logger.warn(`laya: sidecar exited with code ${String(code)}, restarting`)
      this.state = 'off'
      void this.start()
      return
    }
    this.fail(`Laya stopped unexpectedly (exit code ${String(code)}). See ${join(this.root, 'laya-serve.log')}`)
  }

  private fail(message: string): void {
    this.state = 'error'
    this.error = message
    this.phase = undefined
    this.progress = undefined
    this.logger.warn(`laya: ${message}`)
  }
}
