/** Host reads and writes the composer's model setup modal performs. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.remote merge for the llm, settings and credentials namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.remote merge for the built-in localModels namespace.
import type {} from '@deepseek-ai/dsh-local-models/remote'
import type { LocalModelView, LocalStatusView } from '@deepseek-ai/dsh-local-models/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { deriveKeyRef } from './providers.ts'

/** Route id of the built-in llama.cpp server; matches `dsh-local-models`. */
export const LOCAL_ROUTE = 'ghostcode-local'

/** Settings namespace owned by the pi-ai adapter. */
export const PI_AI_NS = 'llm-pi-ai'

/** One model saved under a route. */
export interface SavedModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** One configured route as the modal lists it. */
export interface SavedRoute {
  readonly route: string
  readonly displayName: string
  readonly api?: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly models: readonly SavedModel[]
}

/** Everything a save writes for one route. */
export interface RouteDraft {
  readonly route: string
  readonly displayName: string
  readonly api: string
  readonly baseURL: string
  /** Key typed in this save; undefined keeps the stored one (or none). */
  readonly apiKey?: string
  /** Whether the route authenticates with a stored key at all. */
  readonly keyed: boolean
  readonly models: readonly SavedModel[]
}

/** Built-in local models: scan, install, run, and save as a model route. */
export interface LocalModelOperations {
  status(): Promise<LocalStatusView>
  install(id: string): Promise<LocalStatusView>
  start(id: string): Promise<LocalStatusView>
  stop(): Promise<LocalStatusView>
  remove(id: string): Promise<LocalStatusView>
  /**
   * Save the built-in route listing every installed model.
   * @param baseURL - the running server's OpenAI-compatible root.
   * @param models - installed catalog models.
   */
  saveRoute(baseURL: string, models: readonly LocalModelView[]): Promise<void>
}

/** The Host operations the setup modal invokes. */
export interface SetupOperations {
  listRoutes(): Promise<readonly SavedRoute[]>
  discover(request: { baseURL: string, api: string, apiKey?: string, provider?: string }): Promise<readonly LlmDiscoveredModel[]>
  saveRoute(draft: RouteDraft): Promise<void>
  removeRoute(route: string, apiKeyEnv: string | undefined): Promise<void>
  /** Absent when the Host has no built-in local models plugin. */
  readonly local?: LocalModelOperations
}

/** Output budget for local replies; the server's context window bounds the rest. */
const LOCAL_MAX_TOKENS = 32_768

/** Unwrap a Remote outcome or throw its message. */
async function settle<T>(call: Promise<RemoteResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function savedModels(value: unknown): SavedModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const model = record(entry)
    const id = text(model?.['id'])
    if (model === undefined || id === undefined) return []
    const name = text(model['name'])
    const contextWindow = count(model['contextWindow'])
    const maxTokens = count(model['maxTokens'])
    return [{
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    }]
  })
}

/**
 * Bind the modal's Host operations to the plugin's Remote namespaces.
 * @param ctx - the plugin context declaring remote.llm, remote.settings and remote.credentials.
 * @param localReady - resolves to a scope that injects remote.localModels, or undefined when the Host lacks it.
 * @returns the callbacks the seat injects.
 */
export function createSetupOperations(ctx: ClientContext, localReady?: Promise<ClientContext | undefined>): SetupOperations {
  const local = async <T>(call: (scope: ClientContext) => Promise<RemoteResult<T>>): Promise<T> => {
    const scope = localReady === undefined ? undefined : await localReady
    if (scope === undefined) throw new Error('built-in local models are unavailable on this Host')
    return await settle(call(scope))
  }
  const localOperations: LocalModelOperations = {
    status: () => local(scope => scope.remote.localModels.status()),
    install: id => local(scope => scope.remote.localModels.installModel(id)),
    start: id => local(scope => scope.remote.localModels.startModel(id)),
    stop: () => local(scope => scope.remote.localModels.stopModel()),
    remove: id => local(scope => scope.remote.localModels.removeModel(id)),
    saveRoute: async (baseURL, models) => {
      // llama.cpp chat templates reject the `developer` role and ignore OpenAI-only fields.
      const profile = {
        displayName: 'GhostCode Local',
        api: 'openai-completions',
        baseURL,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: 'max_tokens',
        },
        models: models.map(model => ({
          id: model.id,
          name: `${model.name} (${model.bits})`,
          contextWindow: model.contextWindow,
          maxTokens: Math.min(LOCAL_MAX_TOKENS, Math.floor(model.contextWindow / 2)),
          reasoningEfforts: false,
        })),
      }
      const written = await ctx.remote.settings.mutate(
        PI_AI_NS,
        [{ op: 'set', path: ['providers', LOCAL_ROUTE], value: profile as unknown as JsonValue }],
        undefined,
      )
      if (!written.ok) throw new Error(written.error.message)
    },
  }
  return {
    ...localReady === undefined ? {} : { local: localOperations },
    listRoutes: async () => {
      const response = await ctx.remote.settings.describe()
      if (!response.ok) throw new Error(response.error.message)
      const view = response.value.namespaces.find(namespace => namespace.ns === PI_AI_NS)
      const providers = record(record(view?.value)?.['providers'])
      if (providers === undefined) return []
      return Object.entries(providers).flatMap(([route, raw]) => {
        const profile = record(raw)
        if (profile === undefined) return []
        const api = text(profile['api'])
        const baseURL = text(profile['baseURL'])
        const apiKeyEnv = text(profile['apiKeyEnv'])
        return [{
          route,
          displayName: text(profile['displayName']) ?? route,
          ...api === undefined ? {} : { api },
          ...baseURL === undefined ? {} : { baseURL },
          ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
          models: savedModels(profile['models']),
        }]
      })
    },
    discover: async (request) => {
      const response = await ctx.remote.llm.discoverModels(PI_AI_NS, request)
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    },
    saveRoute: async (draft) => {
      const keyRef = deriveKeyRef(draft.route)
      const profile = {
        displayName: draft.displayName,
        api: draft.api,
        baseURL: draft.baseURL,
        ...draft.keyed ? { apiKeyEnv: keyRef } : {},
        models: draft.models.map(model => ({ ...model })),
      }
      const written = await ctx.remote.settings.mutate(
        PI_AI_NS,
        [{ op: 'set', path: ['providers', draft.route], value: profile as unknown as JsonValue }],
        undefined,
      )
      if (!written.ok) throw new Error(written.error.message)
      if (draft.apiKey !== undefined && draft.apiKey.length > 0) {
        const stored = await ctx.remote.credentials.set(keyRef, draft.apiKey)
        if (!stored.ok) throw new Error(stored.error.message)
      }
    },
    removeRoute: async (route, apiKeyEnv) => {
      const written = await ctx.remote.settings.mutate(PI_AI_NS, [{ op: 'unset', path: ['providers', route] }], undefined)
      if (!written.ok) throw new Error(written.error.message)
      if (apiKeyEnv !== undefined) {
        const removed = await ctx.remote.credentials.unset(apiKeyEnv)
        if (!removed.ok) throw new Error(removed.error.message)
      }
    },
  }
}
