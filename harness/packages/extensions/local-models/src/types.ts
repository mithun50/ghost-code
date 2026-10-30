/** Wire vocabulary of the local models plugin. */

/** Bytes on disk so far for a download with a known size. */
export interface DownloadProgress {
  readonly done: number
  readonly total: number
}

/** What the scan found about this computer. */
export interface SystemInfo {
  readonly platform: string
  readonly arch: string
  readonly cpu: string
  readonly threads: number
  readonly totalRam: number
  readonly freeRam: number
  readonly gpus: readonly string[]
  /** Free bytes on the drive that holds the models; absent when unknown. */
  readonly freeDisk?: number
}

/** How well a model fits the free memory right now. */
export type ModelFit = 'good' | 'tight' | 'too-big'

/** One catalog model as the browser renders it. */
export interface LocalModelView {
  readonly id: string
  readonly name: string
  /** Total parameters, for example `8.3B`. */
  readonly params: string
  /** Active parameters per token; differs from `params` for MoE models. */
  readonly activeParams: string
  /** Quantization width, for example `2-bit`. */
  readonly bits: string
  readonly quant: string
  readonly size: number
  /** Estimated RAM while loaded, including the context cache. */
  readonly ramNeed: number
  readonly contextWindow: number
  readonly license: string
  readonly notes: string
  readonly fit: ModelFit
  /** Estimated generation speed on this machine, tokens per second. */
  readonly estimatedTps: number
  /** Generation speed measured on this machine after the first start. */
  readonly measuredTps?: number
  readonly recommended: boolean
  readonly installed: boolean
  /** Present while this model downloads. */
  readonly progress?: DownloadProgress
  /** Last install failure for this model. */
  readonly error?: string
}

/** The llama.cpp runtime GhostCode downloads with the first model. */
export interface RuntimeView {
  readonly state: 'missing' | 'downloading' | 'ready' | 'error'
  /** Which llama.cpp build this machine uses, for example `Vulkan`. */
  readonly backend: string
  readonly size: number
  readonly progress?: DownloadProgress
  readonly error?: string
}

/** The one local model server. */
export interface ServerView {
  readonly state: 'stopped' | 'starting' | 'running' | 'error'
  /** Model id the server is loading or serving. */
  readonly model?: string
  /** OpenAI-compatible base URL, present while running. */
  readonly baseURL?: string
  readonly phase?: string
  readonly error?: string
}

/** Everything the Local tab renders, read in one call. */
export interface LocalStatusView {
  readonly system: SystemInfo
  readonly runtime: RuntimeView
  readonly server: ServerView
  readonly models: readonly LocalModelView[]
  /** OpenAI-compatible base URL the built-in server uses, running or not. */
  readonly endpoint: string
}

/** One hard-evidence check of a finished command. */
export interface EvidenceCheck {
  readonly time: number
  readonly tool: string
  readonly passed: boolean
  readonly reason: string
}

/** Running totals for one session's privacy and escalation guard. */
export interface GuardTotals {
  readonly passed: number
  readonly failed: number
  /** Consecutive failed checks. */
  readonly streak: number
  /** Whether the session is on the cloud because evidence showed the local answer failing. */
  readonly escalated: boolean
  readonly secretsRemoved: number
  readonly filesWithheld: number
  readonly blockedReads: number
  readonly bytesSent: number
  readonly cloudRequests: number
  readonly recoveries: number
}

/** What the composer badge shows for one session. */
export interface GuardView {
  /** Where the next request goes. */
  readonly route: 'local' | 'cloud' | 'none'
  readonly provider?: string
  readonly model?: string
  readonly cloudPolicy: 'allow' | 'block'
  /** Configured escalation target, `provider/model`, or empty when escalation is off. */
  readonly escalateTo: string
  readonly escalateAfter: number
  readonly totals: GuardTotals
  readonly checks: readonly EvidenceCheck[]
  readonly freeRam: number
  readonly laya?: string
}

/** One line of the egress log. */
export interface EgressEntry {
  readonly time: number
  readonly sessionId?: string
  readonly kind: 'cloud-request' | 'blocked-request' | 'blocked-read' | 'escalated' | 'returned-local' | 'local-recovery'
  readonly provider?: string
  readonly model?: string
  readonly bytes?: number
  readonly files?: readonly string[]
  readonly secretsRemoved?: number
  readonly secretKinds?: readonly string[]
  readonly withheld?: readonly string[]
  readonly detail?: string
}
