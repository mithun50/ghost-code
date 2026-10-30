/** Wire vocabulary of the Laya decision plugin. */

/** Lifecycle of the local Laya install and its sidecar. */
export type LayaState = 'not-installed' | 'installing' | 'off' | 'starting' | 'on' | 'error'

/** Bytes downloaded so far during an install step that has a known size. */
export interface LayaProgress {
  readonly done: number
  readonly total: number
}

/** Redacted plugin state the browser renders. Never carries the sidecar key. */
export interface LayaStatusView {
  readonly state: LayaState
  /** Human-readable phase while installing or starting. */
  readonly phase?: string
  /** Download progress, present while a sized download runs. */
  readonly progress?: LayaProgress
  /** Last failure, when `state` is `error`. */
  readonly error?: string
  /** Decisions recorded since the Host started. */
  readonly decisionCount: number
}

/** One recorded Laya decision. */
export interface LayaDecision {
  /** Epoch milliseconds when the decision settled. */
  readonly time: number
  /** Hook that asked: `turn-stopping` or `post-execute`. */
  readonly hook: string
  readonly question: string
  /** Yes-probability, absent when Laya abstained. */
  readonly probability?: number
  readonly latencyMs: number
  /** What the harness did: `continue`, `stop`, `flag-failure`, `pass` or `abstain`. */
  readonly action: string
  /** Session the decision belongs to. */
  readonly sessionId?: string
}
