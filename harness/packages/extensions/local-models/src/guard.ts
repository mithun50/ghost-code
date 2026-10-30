/**
 * "Never leak, verify before escalating": what may leave the machine, and
 * when a task may move to the cloud.
 *
 * - Cloud requests are scanned: secrets become `[REDACTED:kind]` markers and
 *   results of tool calls on secret files (`.env`, keys) are withheld.
 * - While a cloud model is active, reads of secret files are denied.
 * - Escalation happens only on evidence (failed commands, non-zero exit
 *   codes), never because a question looks hard. One passing check returns
 *   the session to its local model.
 * - Low memory and a crashed local server are recovered locally, never by
 *   moving to the cloud.
 * - Every cloud request, block, escalation and recovery is logged.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { collectPaths, redactBlocks, redactText, sensitiveTarget } from './egress.ts'
import type { EgressEntry, EvidenceCheck, GuardTotals } from './types.ts'

/** Routes whose requests never leave the machine. */
export const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(['ghostcode-local', 'ollama', 'lmstudio'])

/**
 * Whether a provider route keeps requests on this machine.
 * @param provider - route id.
 * @returns true for built-in and loopback runtimes.
 */
export function isLocalProvider(provider: string | undefined): boolean {
  return provider !== undefined && LOCAL_PROVIDERS.has(provider)
}

/** Result of preparing one cloud request. */
export interface CleanedRequest<M> {
  readonly messages: readonly M[]
  readonly system: string | undefined
  readonly found: readonly string[]
  readonly withheld: readonly string[]
  readonly files: readonly string[]
  readonly bytes: number
}

type Blocks = readonly unknown[]
interface MessageLike { readonly role?: unknown, readonly content?: unknown, readonly toolCallId?: unknown }

/** Map tool-call ids to the secret file each call touched. */
function secretCalls(messages: readonly MessageLike[]): Map<string, string> {
  const calls = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as Blocks) {
      const record = block as Record<string, unknown> | null
      if (record?.['type'] !== 'tool-call' || typeof record['arguments'] !== 'string') continue
      let args: unknown
      try { args = JSON.parse(record['arguments']) } catch { continue }
      const target = sensitiveTarget(args)
      if (target !== undefined && typeof record['id'] === 'string') calls.set(record['id'], target)
    }
  }
  return calls
}

/**
 * Prepare a request for a cloud provider.
 * @param messages - the outgoing conversation.
 * @param system - one-shot system prompt, when present.
 * @returns cleaned copies and what was removed.
 */
export function cleanRequest<M>(messages: readonly M[], system: string | undefined): CleanedRequest<M> {
  const found: string[] = []
  const withheld: string[] = []
  const files = new Set<string>()
  const secret = secretCalls(messages as readonly MessageLike[])
  const cleaned = messages.map((raw) => {
    const message = raw as MessageLike
    if (!Array.isArray(message.content)) return raw
    const blocks = message.content as Blocks
    collectPaths(blocks, files)
    const file = typeof message.toolCallId === 'string' ? secret.get(message.toolCallId) : undefined
    if (message.role === 'tool' && file !== undefined) {
      withheld.push(file)
      const note = `[withheld by GhostCode: ${file} holds secrets and never leaves this machine]`
      return { ...message, content: [{ type: 'text', text: note }] } as M
    }
    const result = redactBlocks(blocks)
    found.push(...result.found)
    return result.blocks === blocks ? raw : { ...message, content: result.blocks } as M
  })
  const systemResult = system === undefined ? undefined : redactText(system)
  if (systemResult !== undefined) found.push(...systemResult.found)
  const bytes = Buffer.byteLength(JSON.stringify(cleaned)) + Buffer.byteLength(systemResult?.text ?? '')
  return { messages: cleaned, system: systemResult?.text, found, withheld, files: [...files], bytes }
}

/** Exit-code markers the shell tools print, and error words test runners print. */
const EXIT_CODE = /\[exit code: (-?\d+)\]|exit code[:\s]+(-?\d+)/i
const FAILURE_WORDS = /\b(?:\d+ (?:failed|failing)|Tests?:\s+\d+ failed|FAIL\b|Error: |error TS\d+|SyntaxError|ReferenceError|TypeError|npm ERR!|ERR_PNPM_|Build failed|Command failed|Traceback \(most recent call last\))/

/**
 * Judge one finished shell command from hard evidence only.
 * @param isError - whether the tool itself reported failure.
 * @param output - the command's output text.
 * @returns whether it passed, and why.
 */
export function judgeCommand(isError: boolean, output: string): { passed: boolean, reason: string } {
  const exit = EXIT_CODE.exec(output)
  const code = exit === null ? undefined : Number(exit[1] ?? exit[2])
  if (code !== undefined && code !== 0) return { passed: false, reason: `exit code ${String(code)}` }
  if (isError) return { passed: false, reason: 'the tool reported an error' }
  const words = FAILURE_WORDS.exec(output)
  if (words !== null) return { passed: false, reason: `output reports "${words[0].trim()}"` }
  return { passed: true, reason: code === 0 ? 'exit code 0' : 'no failure in the output' }
}

/** Per-session evidence and egress totals. */
export class SessionGuard {
  passed = 0
  failed = 0
  /** Consecutive failed checks since the last pass. */
  streak = 0
  readonly checks: EvidenceCheck[] = []
  /** The local selection a session escalated from, while it runs on the cloud on evidence. */
  escalatedFrom: { provider: string, model: string } | undefined
  secretsRemoved = 0
  filesWithheld = 0
  blockedReads = 0
  bytesSent = 0
  cloudRequests = 0
  recoveries = 0

  record(check: EvidenceCheck): void {
    this.checks.push(check)
    if (this.checks.length > 20) this.checks.shift()
    if (check.passed) { this.passed++; this.streak = 0 } else { this.failed++; this.streak++ }
  }

  totals(): GuardTotals {
    return {
      passed: this.passed,
      failed: this.failed,
      streak: this.streak,
      escalated: this.escalatedFrom !== undefined,
      secretsRemoved: this.secretsRemoved,
      filesWithheld: this.filesWithheld,
      blockedReads: this.blockedReads,
      bytesSent: this.bytesSent,
      cloudRequests: this.cloudRequests,
      recoveries: this.recoveries,
    }
  }
}

/** Append-only JSON-lines log of everything that crossed, or was stopped at, the machine boundary. */
export class EgressLog {
  private readonly recent: EgressEntry[] = []

  constructor(private readonly path: string) {}

  write(entry: EgressEntry): void {
    this.recent.push(entry)
    if (this.recent.length > 200) this.recent.shift()
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`)
    } catch { /* the in-memory log still serves the UI */ }
  }

  list(limit: number, sessionId?: string): EgressEntry[] {
    const rows = sessionId === undefined ? this.recent : this.recent.filter(entry => entry.sessionId === sessionId)
    return rows.slice(-Math.max(1, Math.min(200, limit)))
  }
}
