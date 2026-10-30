/**
 * Provider-requested retry delay parsing and the never-retry rule.
 *
 * pi-ai flattens HTTP errors to a message string before they reach Harness,
 * so response headers are usually lost; the message parse is the fallback
 * that keeps a rate-limited retry outside the provider's limit window.
 *
 * @module @deepseek-ai/dsh-llm-retry/delay
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm'

/** Longest single wait the retry layer schedules for a provider instruction. */
export const MAX_PROVIDER_WAIT_MS = 60_000

type HeaderSource = Headers | Readonly<Record<string, string | undefined>>

function header(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
  return key === undefined ? undefined : headers[key]
}

function headerNames(headers: HeaderSource): string[] {
  return headers instanceof Headers ? [...headers.keys()] : Object.keys(headers).map(name => name.toLowerCase())
}

function positive(ms: number): number | undefined {
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }

/**
 * Parse a Go-style duration such as `7.66s`, `2m59.56s`, `20ms`, or a bare number of seconds.
 * @param value - header value.
 * @returns positive milliseconds, or undefined when unparseable.
 */
export function parseDuration(value: string): number | undefined {
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return positive(Number(text) * 1_000)
  if (!/^(?:\d+(?:\.\d+)?(?:ms|h|m|s))+$/i.test(text)) return undefined
  let total = 0
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi)) {
    total += Number(amount) * UNIT_MS[unit!.toLowerCase()]!
  }
  return positive(total)
}

/**
 * Read the provider-requested delay from HTTP response headers:
 * `retry-after-ms`, then `retry-after` (seconds or HTTP date), then
 * `x-ratelimit-reset-*` (preferring exhausted buckets).
 * @param headers - response headers.
 * @param now - current epoch milliseconds, for HTTP-date values.
 * @returns positive milliseconds, or undefined when no header applies.
 */
export function retryDelayFromHeaders(headers: HeaderSource, now: number = Date.now()): number | undefined {
  const ms = header(headers, 'retry-after-ms')
  if (ms !== undefined && /^\s*\d+(?:\.\d+)?\s*$/.test(ms)) {
    const parsed = positive(Number(ms))
    if (parsed !== undefined) return parsed
  }
  const after = header(headers, 'retry-after')?.trim()
  if (after !== undefined && after.length > 0) {
    if (/^\d+(?:\.\d+)?$/.test(after)) {
      const parsed = positive(Number(after) * 1_000)
      if (parsed !== undefined) return parsed
    } else {
      const date = Date.parse(after)
      if (Number.isFinite(date)) {
        const parsed = positive(date - now)
        if (parsed !== undefined) return parsed
      }
    }
  }
  const all: number[] = []
  const exhausted: number[] = []
  for (const name of headerNames(headers)) {
    if (!name.startsWith('x-ratelimit-reset-')) continue
    const parsed = parseDuration(header(headers, name) ?? '')
    if (parsed === undefined) continue
    all.push(parsed)
    const bucket = name.slice('x-ratelimit-reset-'.length)
    if (header(headers, `x-ratelimit-remaining-${bucket}`)?.trim() === '0') exhausted.push(parsed)
  }
  const chosen = exhausted.length > 0 ? exhausted : all
  return chosen.length > 0 ? Math.max(...chosen) : undefined
}

/**
 * Parse `try again in <number>(ms|s|m)` from a provider error message.
 * @param message - provider error text.
 * @returns positive milliseconds, or undefined when the phrase is absent.
 */
export function retryDelayFromMessage(message: string): number | undefined {
  const match = /try again in\s+(\d+(?:\.\d+)?)\s*(ms|s|m)\b/i.exec(message)
  if (match === null) return undefined
  return positive(Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]!)
}

/**
 * Provider-requested delay for one failure: the structured
 * `providerRetryAfterMs`, otherwise the message parse.
 * @param failure - serializable failure facts.
 * @returns positive milliseconds, or undefined.
 */
export function providerRequestedDelay(failure: LlmFailure): number | undefined {
  const structured = failure.providerRetryAfterMs
  if (structured !== undefined && Number.isFinite(structured) && structured > 0) return structured
  return retryDelayFromMessage(failure.message)
}

/**
 * Add a small positive jitter on top of a provider-requested delay and cap the wait.
 * @param requestedMs - provider-requested delay.
 * @param random - sample in [0, 1].
 * @returns delay in milliseconds, at least `requestedMs` unless capped.
 */
export function providerWait(requestedMs: number, random: () => number): number {
  const spread = Math.min(1_000, Math.max(100, requestedMs * 0.1))
  return Math.min(Math.ceil(requestedMs + spread * random()), MAX_PROVIDER_WAIT_MS)
}

/**
 * Whether resending the same request can never succeed: an HTTP 413, or a
 * rate-limit response that rejects the request size rather than the rate.
 * @param failure - serializable failure facts.
 * @returns true when the failure must not be retried.
 */
export function isNeverRetryable(failure: LlmFailure): boolean {
  if (failure.status === 413) return true
  return /\b413\b|request too large|reduce your message size|payload too large/i.test(failure.message)
}
