/**
 * Keyless DuckDuckGo `WebSearchProvider` plugin with a Wikipedia fallback. It
 * contributes to the `ctx.web` registry without owning the service, and needs
 * no credential, so search works for every chat model route.
 *
 * @module @deepseek-ai/dsh-web-search-duckduckgo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  DuckDuckGoSearchProvider,
  DUCKDUCKGO_LITE_URL,
  GHOSTCODE_USER_AGENT,
  WIKIPEDIA_API_URL,
} from './provider.ts'

export {
  decodeEntities,
  DUCKDUCKGO_LITE_URL,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
  GHOSTCODE_USER_AGENT,
  parseLiteResults,
  parseWikipediaResults,
  resolveResultUrl,
  WIKIPEDIA_API_URL,
} from './provider.ts'
export type { DuckDuckGoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional; `apply` fills constant defaults). */
export interface Config {
  /** DuckDuckGo Lite endpoint. */
  liteURL?: string
  /** Wikipedia API endpoint used as the fallback; empty disables it. */
  wikipediaURL?: string
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}

export const Config: z<Config> = z.object({
  liteURL: z.string(),
  wikipediaURL: z.string(),
  userAgent: z.string(),
})

/** Register the keyless search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    liteURL: config.liteURL ?? DUCKDUCKGO_LITE_URL,
    wikipediaURL: config.wikipediaURL ?? WIKIPEDIA_API_URL,
    userAgent: config.userAgent ?? GHOSTCODE_USER_AGENT,
  }))
}
