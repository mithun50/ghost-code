/** Find secrets in text that would leave the machine, and recognize files that must never leave it. */

/** Well-known credential formats, matched anywhere in text. */
const TOKEN_RULES: ReadonlyArray<{ kind: string, re: RegExp }> = [
  { kind: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { kind: 'groq-key', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { kind: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
]

/** `NAME=value`, `"name": "value"` and `name: value` where the name says it holds a secret. */
const ASSIGNMENT = /((?:^|[\s"'{,;(])(?:export\s+)?[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)([^\s"'`,;})]{6,})/gim

/** The password part of `scheme://user:password@host`. */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi

/** Values that name a secret instead of holding one. */
const NOT_A_SECRET = /^(?:string|number|boolean|undefined|null|true|false|none|required|optional|changeme|example|placeholder|your[_-]\w*|x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{?[A-Za-z_][\w]*\}?|%[A-Za-z_]\w*%|process\.env\.\w+|os\.environ.*|env\(.*)$/i

function looksSecret(value: string): boolean {
  if (NOT_A_SECRET.test(value) || value.includes('(') || value.startsWith('[REDACTED')) return false
  // A dotted identifier is a reference such as `config.token`, not a value.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value)) return false
  return value.length >= 16 || (value.length >= 8 && /\d/.test(value) && /[A-Za-z]/.test(value))
}

/** Result of one redaction pass. */
export interface Redaction {
  readonly text: string
  /** Kind of every secret replaced, one entry per occurrence. */
  readonly found: readonly string[]
}

/**
 * Replace every secret in `text` with a `[REDACTED:kind]` marker.
 * @param text - text that may leave the machine.
 * @returns the cleaned text and what was removed.
 */
export function redactText(text: string): Redaction {
  const found: string[] = []
  let out = text
  for (const { kind, re } of TOKEN_RULES) {
    out = out.replace(re, () => { found.push(kind); return `[REDACTED:${kind}]` })
  }
  out = out.replace(URL_PASSWORD, (_all, head: string, _password: string, at: string) => {
    found.push('url-password')
    return `${head}[REDACTED:password]${at}`
  })
  out = out.replace(ASSIGNMENT, (all, head: string, value: string) => {
    if (!looksSecret(value)) return all
    found.push('assigned-secret')
    return `${head}[REDACTED:secret]`
  })
  return { text: out, found }
}

/** Files whose contents never leave the machine. Templates such as `.env.example` stay allowed. */
const SENSITIVE_PATH = /(?:^|[\\/\s"'`=:])(\.env(?:\.(?!example\b|sample\b|template\b|dist\b|defaults\b)[\w-]+)*|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(?:rsa|ed25519|ecdsa|dsa)|[\w.-]+\.(?:pem|p12|pfx|keystore|jks)|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml|env)|\.ssh[\\/][^\s"'`]*|\.aws[\\/][^\s"'`]*|\.gnupg[\\/][^\s"'`]*)(?=$|[\s"'`;|&)>])/i

const PATH_ARGS = ['file_path', 'path', 'pattern', 'glob', 'paths', 'target']
const COMMAND_ARGS = ['command', 'cmd', 'script']

/**
 * Name the secret file a tool call would read, if any.
 * @param args - the tool call's parsed arguments.
 * @returns the matched path, or undefined when the call touches no secret file.
 */
export function sensitiveTarget(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of [...PATH_ARGS, ...COMMAND_ARGS]) {
    const raw = record[key]
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      if (typeof value !== 'string') continue
      const match = SENSITIVE_PATH.exec(value)
      if (match?.[1] !== undefined) return match[1]
    }
  }
  return undefined
}

/**
 * Redact secrets inside model-facing content blocks: text, reasoning and
 * tool-call arguments. Other blocks pass through unchanged.
 * @param blocks - content blocks.
 * @returns new blocks, or the same array when nothing changed, plus what was removed.
 */
export function redactBlocks<T>(blocks: readonly T[]): { blocks: readonly T[], found: string[] } {
  const found: string[] = []
  let changed = false
  const next = blocks.map((block) => {
    if (block === null || typeof block !== 'object') return block
    const record = block as Record<string, unknown>
    const field = record['type'] === 'tool-call' ? 'arguments' : (record['type'] === 'text' || record['type'] === 'reasoning') ? 'text' : undefined
    const value = field === undefined ? undefined : record[field]
    if (field === undefined || typeof value !== 'string') return block
    const result = redactText(value)
    if (result.found.length === 0) return block
    found.push(...result.found)
    changed = true
    return { ...record, [field]: result.text } as T
  })
  return { blocks: changed ? next : blocks, found }
}

/**
 * Collect file paths named by tool calls, to show which files a cloud request carries.
 * @param blocks - content blocks of one message.
 * @param into - set receiving the paths.
 */
export function collectPaths(blocks: readonly unknown[], into: Set<string>): void {
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record['type'] !== 'tool-call' || typeof record['arguments'] !== 'string') continue
    try {
      const args = JSON.parse(record['arguments']) as Record<string, unknown>
      const path = args['file_path'] ?? args['path']
      if (typeof path === 'string') into.add(path)
    } catch { /* partial or non-JSON arguments carry no path */ }
  }
}
