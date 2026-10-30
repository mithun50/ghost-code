/** Host reads and writes the composer's model setup modal performs. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.remote merge for the llm, settings and credentials namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { deriveKeyRef } from './providers.ts'

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

/** The Host operations the setup modal invokes. */
export interface SetupOperations {
  listRoutes(): Promise<readonly SavedRoute[]>
  discover(request: { baseURL: string, api: string, apiKey?: string, provider?: string }): Promise<readonly LlmDiscoveredModel[]>
  saveRoute(draft: RouteDraft): Promise<void>
  removeRoute(route: string, apiKeyEnv: string | undefined): Promise<void>
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
 * @returns the callbacks the seat injects.
 */
export function createSetupOperations(ctx: ClientContext): SetupOperations {
  return {
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
