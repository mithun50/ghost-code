/** On-demand install and lifecycle of the local `laya-serve` sidecar. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { healthy, type LayaEndpoint } from './client.ts'
import type { LayaState } from './types.ts'

/** CPU wheels keep the install near 700 MB instead of a multi-GB CUDA build. */
const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu'
/** First start may download the checkpoint, so readiness waits generously. */
const START_TIMEOUT_MS = 240_000
const MAX_RESTARTS = 3

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

/** Owns the venv under `<home>/laya` and the one running sidecar. */
export class LayaSidecar {
  state: LayaState
  phase: string | undefined
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

  /** Whether the venv holds a `laya-serve` entry point. */
  installed(): boolean { return existsSync(this.server) }

  /** Install Laya with uv. Only the user's Install click calls this. */
  async install(): Promise<void> {
    if (this.state === 'installing') return
    this.state = 'installing'
    this.error = undefined
    try {
      this.phase = 'Creating Python environment'
      await run('uv', ['venv', '--python', '3.12', this.venv], (line) => { this.phase = line })
      this.phase = 'Downloading Laya (about 700 MB)'
      await run('uv', ['pip', 'install', '--python', this.python, 'laya[serve]',
        '--extra-index-url', TORCH_CPU_INDEX, '--index-strategy', 'unsafe-best-match'], (line) => { this.phase = line })
      if (!this.installed()) throw new Error('install finished but laya-serve was not found')
      this.state = 'off'
      this.phase = undefined
    } catch (error: unknown) {
      this.fail(`Install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Remove the venv. The decision log stays. */
  uninstall(): void {
    this.stop()
    rmSync(this.venv, { recursive: true, force: true })
    this.state = 'not-installed'
    this.phase = undefined
    this.error = undefined
  }

  /** Start the sidecar on loopback with a fresh port and key. */
  async start(): Promise<void> {
    if (!this.installed()) { this.state = 'not-installed'; return }
    if (this.state === 'on' || this.state === 'starting') return
    this.wanted = true
    this.state = 'starting'
    this.phase = 'Starting Laya'
    this.error = undefined
    const port = await freePort()
    const apiKey = randomBytes(24).toString('hex')
    const endpoint = { baseURL: `http://127.0.0.1:${port}`, apiKey }
    const child = spawn(this.server, [], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LAYA_HOST: '127.0.0.1',
        LAYA_PORT: String(port),
        LAYA_API_KEY: apiKey,
        LAYA_DEVICE: 'cpu',
        LAYA_MAX_LOADED: '1',
        LAYA_IDLE_UNLOAD_SECONDS: '600',
        HF_HOME: join(this.root, 'hf'),
      },
    })
    this.child = child
    child.once('exit', (code) => { this.onExit(child, code) })
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
      this.fail('Laya did not become ready in time')
    }
  }

  /** Stop the sidecar; hooks become no-ops. */
  stop(): void {
    this.wanted = false
    const child = this.child
    this.child = undefined
    this.endpoint = undefined
    child?.kill()
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
    this.fail(`Laya stopped unexpectedly (exit code ${String(code)})`)
  }

  private fail(message: string): void {
    this.state = 'error'
    this.error = message
    this.phase = undefined
    this.logger.warn(`laya: ${message}`)
  }
}
