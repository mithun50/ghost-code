/** Minimal fetch client for the `laya-serve` `/v1/systemone` endpoint. */

/** One `noul` (yes-probability) question. */
export interface NoulQuestion {
  readonly type: 'noul'
  readonly instructions: string
}

/** Result of one yes/no ask; `probability` is absent when Laya abstained. */
export interface NoulOutcome {
  readonly probability?: number
  readonly latencyMs: number
  readonly error?: string
}

/** Where the sidecar listens and how to authenticate. */
export interface LayaEndpoint {
  readonly baseURL: string
  readonly apiKey: string
}

/** Clamp to a probability, or undefined when the field is not a finite number. */
function probabilityOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  if (typeof value === 'boolean') return value ? 1 : 0
  return undefined
}

/**
 * Read the yes-probability from one answer. laya-serve reports `noul` answers
 * as a number or as `probabilities.yes`; both shapes are accepted.
 * @param answer - one entry of the response `answers` map.
 * @returns the probability, or undefined when the answer carries none.
 */
export function noulProbability(answer: unknown): number | undefined {
  if (answer === null || typeof answer !== 'object') return undefined
  const record = answer as Record<string, unknown>
  const direct = probabilityOf(record['noul'])
  if (direct !== undefined) return direct
  const probabilities = record['probabilities']
  if (probabilities !== null && typeof probabilities === 'object') {
    const yes = (probabilities as Record<string, unknown>)['yes'] ?? (probabilities as Record<string, unknown>)['true']
    return probabilityOf(yes)
  }
  return undefined
}

/**
 * Ask one yes/no question about a state. Never throws: a timeout, HTTP error
 * or malformed body returns an outcome without a probability.
 * @param endpoint - sidecar address and key.
 * @param state - the text Laya judges.
 * @param question - the question.
 * @param timeoutMs - abort budget.
 * @returns the outcome with its measured latency.
 */
export async function askNoul(
  endpoint: LayaEndpoint,
  state: string,
  question: NoulQuestion,
  timeoutMs: number,
): Promise<NoulOutcome> {
  const started = performance.now()
  const elapsed = (): number => Math.round(performance.now() - started)
  try {
    const response = await fetch(`${endpoint.baseURL}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
      // Pinned: the sidecar only has the English checkpoint on disk.
      body: JSON.stringify({ model: 'english', state: state.slice(0, 20_000), questions: { q: question } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { latencyMs: elapsed(), error: `laya-serve answered HTTP ${response.status}` }
    const body = await response.json() as { answers?: Record<string, unknown> }
    const probability = noulProbability(body.answers?.['q'])
    return probability === undefined
      ? { latencyMs: elapsed(), error: 'laya-serve returned no noul answer' }
      : { probability, latencyMs: elapsed() }
  } catch (error: unknown) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { latencyMs: elapsed(), error: timedOut ? `timed out after ${timeoutMs} ms` : String(error) }
  }
}

/**
 * Probe the sidecar's health endpoint once.
 * @param endpoint - sidecar address and key.
 * @param timeoutMs - abort budget.
 * @returns true when `/health` answers 2xx.
 */
export async function healthy(endpoint: LayaEndpoint, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.baseURL}/health`, {
      headers: { authorization: `Bearer ${endpoint.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}
