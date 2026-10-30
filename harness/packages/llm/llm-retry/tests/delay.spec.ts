import { describe, expect, it } from 'vitest'
import {
  isNeverRetryable,
  MAX_PROVIDER_WAIT_MS,
  parseDuration,
  providerRequestedDelay,
  providerWait,
  retryDelayFromHeaders,
  retryDelayFromMessage,
} from '../src/delay.ts'

describe('retryDelayFromHeaders', () => {
  it('prefers retry-after-ms over retry-after', () => {
    expect(retryDelayFromHeaders(new Headers({ 'retry-after-ms': '1500', 'retry-after': '9' }))).toBe(1_500)
  })

  it('reads retry-after seconds, including fractions', () => {
    expect(retryDelayFromHeaders(new Headers({ 'retry-after': '7' }))).toBe(7_000)
    expect(retryDelayFromHeaders({ 'Retry-After': '0.5' })).toBe(500)
  })

  it('reads retry-after as an HTTP date relative to now', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')
    expect(retryDelayFromHeaders(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:05 GMT' }), now)).toBe(5_000)
    expect(retryDelayFromHeaders(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:27:00 GMT' }), now)).toBeUndefined()
  })

  it('falls back to the exhausted x-ratelimit-reset bucket', () => {
    expect(retryDelayFromHeaders(new Headers({
      'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-remaining-requests': '10',
      'x-ratelimit-reset-tokens': '7.66s',
      'x-ratelimit-remaining-tokens': '0',
    }))).toBe(7_660)
    expect(retryDelayFromHeaders(new Headers({ 'x-ratelimit-reset-tokens': '20ms' }))).toBe(20)
  })

  it('ignores absent or malformed values', () => {
    expect(retryDelayFromHeaders(new Headers())).toBeUndefined()
    expect(retryDelayFromHeaders(new Headers({ 'retry-after': 'soon', 'retry-after-ms': '-1' }))).toBeUndefined()
  })
})

describe('parseDuration', () => {
  it('parses compound and bare durations', () => {
    expect(parseDuration('1m30s')).toBe(90_000)
    expect(parseDuration('250ms')).toBe(250)
    expect(parseDuration('3')).toBe(3_000)
    expect(parseDuration('abc')).toBeUndefined()
  })
})

describe('retryDelayFromMessage', () => {
  it('parses the Groq-style "try again in" phrase', () => {
    expect(retryDelayFromMessage('429 Rate limit reached for model ... Please try again in 7.1025s. Need more tokens?')).toBe(7_102.5)
    expect(retryDelayFromMessage('Please try again in 640ms')).toBe(640)
    expect(retryDelayFromMessage('please Try Again In 2m')).toBe(120_000)
    expect(retryDelayFromMessage('429 Rate limit reached')).toBeUndefined()
  })

  it('prefers the structured providerRetryAfterMs over the message', () => {
    expect(providerRequestedDelay({ message: 'try again in 7s', code: 'RATE_LIMIT', providerRetryAfterMs: 3_000 })).toBe(3_000)
    expect(providerRequestedDelay({ message: 'try again in 7s', code: 'RATE_LIMIT' })).toBe(7_000)
  })
})

describe('providerWait', () => {
  it('never waits less than requested, adds bounded jitter, and caps at 60 s', () => {
    expect(providerWait(7_102.5, () => 0)).toBe(7_103)
    expect(providerWait(7_102.5, () => 1)).toBe(7_813)
    expect(providerWait(100, () => 1)).toBe(200)
    expect(providerWait(59_900, () => 1)).toBe(MAX_PROVIDER_WAIT_MS)
    expect(providerWait(600_000, () => 0)).toBe(MAX_PROVIDER_WAIT_MS)
  })
})

describe('isNeverRetryable', () => {
  it('flags request-size rejections', () => {
    expect(isNeverRetryable({ message: 'too big', code: 'INVALID_REQUEST', status: 413 })).toBe(true)
    expect(isNeverRetryable({ message: '413 Payload Too Large', code: 'INVALID_REQUEST' })).toBe(true)
    expect(isNeverRetryable({ message: '429 Request too large for model on tokens per minute (TPM)', code: 'RATE_LIMIT' })).toBe(true)
    expect(isNeverRetryable({ message: 'Rate limit reached. Please reduce your message size and try again.', code: 'RATE_LIMIT' })).toBe(true)
  })

  it('leaves ordinary rate limits retryable', () => {
    expect(isNeverRetryable({ message: '429 Rate limit reached. Please try again in 7.1s', code: 'RATE_LIMIT', status: 429 })).toBe(false)
  })
})
