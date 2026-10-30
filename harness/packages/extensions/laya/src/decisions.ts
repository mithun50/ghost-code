/** In-memory ring buffer plus append-only JSONL log of Laya decisions. */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LayaDecision } from './types.ts'

const CAPACITY = 500

/** Records decisions for the UI and for the with/without benchmark. */
export class DecisionLog {
  private readonly buffer: LayaDecision[] = []
  private writes: Promise<void> = Promise.resolve()

  /** @param file - JSONL path, typically `<home>/laya/decisions.jsonl`. */
  constructor(private readonly file: string) {}

  /** Total decisions recorded since construction (bounded buffer aside). */
  count = 0

  /**
   * Record one decision. The file write is serialized and never throws into a hook.
   * @param decision - the settled decision.
   */
  record(decision: LayaDecision): void {
    this.count++
    this.buffer.push(decision)
    if (this.buffer.length > CAPACITY) this.buffer.shift()
    const line = `${JSON.stringify(decision)}\n`
    this.writes = this.writes
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        await appendFile(this.file, line, 'utf8')
      })
      .catch(() => { /* logging must not break the agent */ })
  }

  /**
   * The most recent decisions, newest last.
   * @param limit - maximum entries to return.
   * @returns a copy of the buffer tail.
   */
  recent(limit = 100): LayaDecision[] {
    return this.buffer.slice(-Math.max(0, limit))
  }

  /** Settle pending file writes (tests and shutdown). */
  async flush(): Promise<void> { await this.writes }
}
