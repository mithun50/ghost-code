/** Authenticated Remote operations behind the Local tab and the composer privacy shield. */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CATALOG, runtimeAsset } from './catalog.ts'
import type { LocalModelManager } from './server.ts'
import { bandwidthFrom, estimateTps, fitOf, ramNeed, recommend, scanSystem } from './system.ts'
import type { EgressEntry, GuardView, LocalModelView, LocalStatusView, RuntimeView, ServerView } from './types.ts'

/** The guard state the plugin body owns and the controller exposes. */
export interface GuardHub {
  view(sessionId?: string): GuardView
  egress(limit: number, sessionId?: string): EgressEntry[]
  setPolicy(next: { cloud?: 'allow' | 'block', escalateTo?: string }): void
  /** List installed models in the model menu. */
  ensureRoute?: () => Promise<void>
}

/** Scan, install, start and stop local models; read and set the privacy guard. */
export class LocalModelsController extends TypertRemoteService {
  /**
   * @param ctx - Host context owning the plugin.
   * @param manager - the install and server owner.
   * @param hub - the privacy and escalation guard.
   */
  constructor(ctx: Context, private readonly manager: LocalModelManager, private readonly hub: GuardHub) {
    super(ctx, 'localModelsController', { namespace: 'localModels' })
  }

  /**
   * Scan the machine and describe every catalog model against it.
   * @returns system, runtime, server and model rows.
   */
  @Remote
  async status(): Promise<LocalStatusView> {
    const manager = this.manager
    const scanned = await scanSystem(manager.root)
    // The running model's memory is available to models: it is freed before another loads.
    const serving = manager.server.model === undefined ? undefined : CATALOG.find(model => model.id === manager.server.model)
    const system = serving === undefined || manager.server.state === 'stopped'
      ? scanned
      : { ...scanned, freeRam: scanned.freeRam + Math.round(serving.size * 1.08) }
    // One measured run calibrates every other estimate on this machine.
    const calibrated = CATALOG.find(model => manager.measured[model.id] !== undefined && model.draft === undefined)
    const bandwidth = calibrated === undefined ? undefined : bandwidthFrom(calibrated, manager.measured[calibrated.id] ?? 0)
    const rows = CATALOG.map((model) => {
      const fit = fitOf(model, system)
      const tps = manager.measured[model.id] ?? estimateTps(model, bandwidth)
      return { model, fit, tps }
    })
    const best = recommend(rows.map(row => ({ id: row.model.id, rank: row.model.rank, fit: row.fit, tps: row.tps })))
    const models: LocalModelView[] = rows.map(({ model, fit, tps }) => {
      const progress = manager.downloads.get(model.id)
      const error = manager.errors.get(model.id)
      const measuredTps = manager.measured[model.id]
      return {
        id: model.id,
        name: model.name,
        params: model.params,
        activeParams: model.activeParams,
        bits: model.bits,
        quant: model.quant,
        size: model.size,
        ramNeed: ramNeed(model),
        contextWindow: model.contextWindow,
        license: model.license,
        notes: model.notes,
        fit,
        estimatedTps: Math.round(tps),
        ...measuredTps === undefined ? {} : { measuredTps },
        recommended: model.id === best,
        installed: manager.installed(model),
        ...progress === undefined ? {} : { progress: { done: progress.done, total: progress.total } },
        ...error === undefined ? {} : { error },
      }
    })
    const asset = runtimeAsset()
    const runtime: RuntimeView = {
      state: manager.runtimeReady() ? 'ready' : manager.runtimeBusy() ? 'downloading' : manager.runtimeError !== undefined ? 'error' : 'missing',
      backend: asset?.asset.backend ?? 'unsupported',
      size: asset?.asset.size ?? 0,
      ...manager.runtimeProgress === undefined ? {} : { progress: { ...manager.runtimeProgress } },
      ...manager.runtimeError === undefined ? {} : { error: manager.runtimeError },
    }
    const { state, model, phase, error } = manager.server
    const server: ServerView = {
      state,
      ...model === undefined ? {} : { model },
      ...state === 'running' ? { baseURL: manager.baseURL } : {},
      ...phase === undefined ? {} : { phase },
      ...error === undefined ? {} : { error },
    }
    return { system, runtime, server, models, endpoint: manager.baseURL }
  }

  /**
   * Download llama.cpp and a model, then start it. Returns at once; poll status().
   * @param id - catalog id.
   * @returns state after the download started.
   */
  @Remote
  async installModel(id: string): Promise<LocalStatusView> {
    void this.manager.install(id).then(() => this.hub.ensureRoute?.())
    return await this.status()
  }

  /**
   * Start the server on an installed model. Returns at once; poll status().
   * @param id - catalog id.
   * @returns state after the start was requested.
   */
  @Remote
  async startModel(id: string): Promise<LocalStatusView> {
    void this.manager.start(id)
    return await this.status()
  }

  /**
   * Stop the server.
   * @returns state after stopping.
   */
  @Remote
  async stopModel(): Promise<LocalStatusView> {
    this.manager.stop()
    return await this.status()
  }

  /**
   * Delete a downloaded model.
   * @param id - catalog id.
   * @returns state after removal.
   */
  @Remote
  async removeModel(id: string): Promise<LocalStatusView> {
    this.manager.remove(id)
    return await this.status()
  }

  /**
   * Read where a session's requests go and what the guard has done.
   * @param sessionId - the session, or empty for the most recently active one.
   * @returns route, policy, evidence and egress totals.
   */
  @Remote
  guardStatus(sessionId: string): GuardView {
    return this.hub.view(sessionId === '' ? undefined : sessionId)
  }

  /**
   * Read the most recent egress log lines for a session.
   * @param limit - maximum entries.
   * @param sessionId - the session, or empty for the most recently active one.
   * @returns entries, newest last.
   */
  @Remote
  egressLog(limit: number, sessionId: string): EgressEntry[] {
    return this.hub.egress(limit, sessionId === '' ? undefined : sessionId)
  }

  /**
   * Allow or block cloud requests, and set the escalation target.
   * @param cloud - `allow` or `block`.
   * @param escalateTo - `provider/model`, or empty to use the first cloud route.
   * @returns the updated guard view.
   */
  @Remote
  setGuardPolicy(cloud: string, escalateTo: string): GuardView {
    this.hub.setPolicy({ cloud: cloud === 'block' ? 'block' : 'allow', escalateTo: escalateTo.trim() })
    return this.hub.view()
  }
}
