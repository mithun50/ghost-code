/** Authenticated Remote operations for the Laya brain button. */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DecisionLog } from './decisions.ts'
import type { LayaSidecar } from './sidecar.ts'
import type { LayaDecision, LayaStatusView } from './types.ts'

/** Persists the on/off choice; absent when no config editor is mounted. */
export type SaveEnabled = (enabled: boolean) => Promise<void>

/** Install, toggle and inspect the local Laya decision engine. */
export class LayaController extends TypertRemoteService {
  /**
   * @param ctx - Host context owning the plugin.
   * @param sidecar - the install and process owner.
   * @param log - the decision log.
   * @param save - persists the toggle across restarts.
   */
  constructor(
    ctx: Context,
    private readonly sidecar: LayaSidecar,
    private readonly log: DecisionLog,
    private readonly save: SaveEnabled,
  ) {
    super(ctx, 'layaController', { namespace: 'laya' })
  }

  /**
   * Read the redacted plugin state. Never includes the sidecar key or port.
   * @returns current state, phase and error.
   */
  @Remote
  status(): LayaStatusView {
    const { state, phase, error } = this.sidecar
    return {
      state,
      ...phase === undefined ? {} : { phase },
      ...error === undefined ? {} : { error },
      decisionCount: this.log.count,
    }
  }

  /**
   * Install Laya into the GhostCode home. Runs only on the user's Install click
   * and returns at once; poll status() for progress.
   * @returns state after the install started.
   */
  @Remote
  installLaya(): LayaStatusView {
    void this.sidecar.install()
    return this.status()
  }

  /**
   * Remove the Laya environment. The decision log is kept.
   * @returns state after removal.
   */
  @Remote
  async uninstall(): Promise<LayaStatusView> {
    this.sidecar.uninstall()
    await this.save(false).catch(() => {})
    return this.status()
  }

  /**
   * Turn decisions on: start the sidecar. Returns at once; poll status().
   * @returns state after start was requested.
   */
  @Remote
  async enable(): Promise<LayaStatusView> {
    void this.sidecar.start()
    await this.save(true).catch(() => {})
    return this.status()
  }

  /**
   * Turn decisions off: stop the sidecar.
   * @returns state after stopping.
   */
  @Remote
  async disable(): Promise<LayaStatusView> {
    this.sidecar.stop()
    await this.save(false).catch(() => {})
    return this.status()
  }

  /**
   * Read recent decisions, newest last.
   * @param limit - maximum entries.
   * @returns recorded decisions.
   */
  @Remote
  decisions(limit: number): LayaDecision[] {
    return this.log.recent(limit)
  }
}
