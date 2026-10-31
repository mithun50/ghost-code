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

/** Verhoeff check digit tables, used to confirm a 12-digit number is a real Aadhaar number. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/**
 * Whether a digit string passes the Verhoeff check (Aadhaar's checksum).
 * @param digits - digits only.
 * @returns true when the last digit is the correct check digit.
 */
export function verhoeffValid(digits: string): boolean {
  let c = 0
  const reversed = [...digits].reverse()
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(reversed[i])]!]!
  }
  return c === 0
}

/**
 * Whether a digit string passes the Luhn check (payment card numbers).
 * @param digits - digits only.
 * @returns true for a valid card number checksum.
 */
export function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

/**
 * Personal data that must not leave the machine (India first: Aadhaar, PAN, UPI, phone; plus cards and email).
 * Numbers are confirmed by their checksum, so ordinary 12 or 16 digit numbers in code are left alone.
 */
const PERSONAL_RULES: ReadonlyArray<{ kind: string, re: RegExp, valid?: (match: string) => boolean }> = [
  // Cards first: a 16-digit card number must not be half-matched as an Aadhaar number.
  { kind: 'card-number', re: /\b(?:\d{4}[ -]?){3}\d{1,4}\b/g, valid: (m) => {
    const digits = m.replace(/\D/g, '')
    return digits.length >= 13 && digits.length <= 16 && /^[2-6]/.test(digits) && luhnValid(digits)
  } },
  { kind: 'aadhaar', re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, valid: m => verhoeffValid(m.replace(/\D/g, '')) },
  { kind: 'pan', re: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g },
  { kind: 'upi-id', re: /\b[\w.-]{2,}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|ibl|axl|apl|paytm|upi|oksbi|waaxis|wahdfcbank|jupiteraxis|fbl)\b/gi },
  { kind: 'phone', re: /(?:\+91[ -]?|\b0?)[6-9]\d{4}[ -]?\d{5}\b/g },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, valid: m => !/@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|anthropic\.com)$/i.test(m) },
]

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
  for (const { kind, re, valid } of PERSONAL_RULES) {
    out = out.replace(re, (match: string) => {
      if (valid !== undefined && !valid(match)) return match
      found.push(kind)
      return `[REDACTED:${kind}]`
    })
  }
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
