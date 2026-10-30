/**
 * `DuckDuckGoSearchProvider`: a keyless `WebSearchProvider`. It reads the
 * DuckDuckGo Lite results page and falls back to the Wikipedia search API when
 * DuckDuckGo answers with no results or a non-200 status (its bot check answers
 * HTTP 202 with an empty page). Neither backend needs a credential, so search
 * works the same for every chat model route.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** DuckDuckGo Lite results page; `q` carries the query. */
export const DUCKDUCKGO_LITE_URL = 'https://lite.duckduckgo.com/lite/'

/** Wikipedia search API used when DuckDuckGo yields nothing. */
export const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php'

/** Honest product agent sent on every request, never a browser disguise. */
export const GHOSTCODE_USER_AGENT = 'GhostCode/0.1 (+https://github.com/mithun50/ghost-code)'

/** Results returned when a request carries no `maxResults`. */
const DEFAULT_MAX_RESULTS = 10

/** Resolved provider options. */
export interface DuckDuckGoSearchProviderOptions {
  /** DuckDuckGo Lite endpoint. */
  liteURL: string
  /** Wikipedia API endpoint; empty disables the fallback. */
  wikipediaURL: string
  /** `User-Agent` header sent on every request. */
  userAgent: string
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'', '#x27': '\'',
}

/**
 * Decode the HTML entities DuckDuckGo and Wikipedia emit.
 * @param text - raw HTML text.
 * @returns the decoded text.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()]
    if (known !== undefined) return known
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    return whole
  })
}

/** Strip tags, decode entities, and collapse whitespace. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a DuckDuckGo redirect link (`//duckduckgo.com/l/?uddg=<target>`) to
 * its target; other links pass through as absolute URLs.
 * @param href - the anchor's `href` attribute, still entity-encoded.
 * @returns the target URL, or undefined when it is not http(s).
 */
export function resolveResultUrl(href: string): string | undefined {
  const decoded = decodeEntities(href)
  let url: URL
  try {
    url = new URL(decoded, 'https://duckduckgo.com')
  } catch {
    return undefined
  }
  const target = url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/'
    ? url.searchParams.get('uddg') ?? undefined
    : url.href
  if (target === undefined) return undefined
  try {
    const parsed = new URL(target)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse the DuckDuckGo Lite results page. Each result is an anchor with
 * `class='result-link'`, followed by a `result-snippet` cell.
 * @param html - the Lite page body.
 * @returns the parsed sources in page order.
 */
export function parseLiteResults(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const linkPattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*class=(["'])result-link\3[^>]*>([\s\S]*?)<\/a>/gi
  const matches = [...html.matchAll(linkPattern)]
  for (const [index, match] of matches.entries()) {
    const url = resolveResultUrl(match[2] ?? '')
    if (url === undefined) continue
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? html.length
    const snippetMatch = /class=(["'])result-snippet\1[^>]*>([\s\S]*?)<\/td>/i.exec(html.slice(start, end))
    const title = plainText(match[4] ?? '')
    const snippet = snippetMatch === null ? '' : plainText(snippetMatch[2] ?? '')
    sources.push({
      url,
      ...title.length > 0 ? { title } : {},
      ...snippet.length > 0 ? { snippet } : {},
    })
  }
  return sources
}

/** One entry of the Wikipedia `list=search` response. */
interface WikipediaHit {
  title?: string
  snippet?: string
  timestamp?: string
}

/**
 * Map a Wikipedia `list=search` response to sources.
 * @param payload - the parsed JSON body.
 * @returns the sources in rank order.
 */
export function parseWikipediaResults(payload: unknown): WebSearchSource[] {
  const hits = (payload as { query?: { search?: WikipediaHit[] } } | null)?.query?.search ?? []
  return hits.flatMap((hit) => {
    if (typeof hit.title !== 'string' || hit.title.length === 0) return []
    const snippet = typeof hit.snippet === 'string' ? plainText(hit.snippet) : ''
    return [{
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      title: hit.title,
      ...snippet.length > 0 ? { snippet } : {},
      ...typeof hit.timestamp === 'string' ? { publishedAt: hit.timestamp } : {},
    }]
  })
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** The keyless DuckDuckGo-then-Wikipedia search provider. */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  constructor(private readonly options: DuckDuckGoSearchProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.options.liteURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const limit = request.maxResults ?? DEFAULT_MAX_RESULTS
    let primaryFailure: unknown
    try {
      const sources = await this.searchLite(request.query, signal)
      if (sources.length > 0) return { sources: sources.slice(0, limit), truncated: false }
    } catch (error: unknown) {
      if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
      primaryFailure = error
    }
    if (this.options.wikipediaURL.length === 0) {
      if (primaryFailure !== undefined) throw primaryFailure
      return { sources: [], truncated: false }
    }
    const fallback = await this.searchWikipedia(request.query, limit, signal)
    return { sources: fallback.slice(0, limit), truncated: false }
  }

  private async get(url: URL, accept: string, signal: AbortSignal | undefined, label: string): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'GET',
        headers: { 'accept': accept, 'user-agent': this.options.userAgent },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError(`${label} search aborted`, 'WEB_ABORTED', { cause: error })
      throw new WebError(`${label} search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async searchLite(query: string, signal: AbortSignal | undefined): Promise<WebSearchSource[]> {
    const url = new URL(this.options.liteURL)
    url.searchParams.set('q', query)
    const response = await this.get(url, 'text/html', signal, 'DuckDuckGo')
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new WebError(`DuckDuckGo answered HTTP ${String(response.status)}`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return parseLiteResults(await response.text())
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo returned an unreadable page: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async searchWikipedia(query: string, limit: number, signal: AbortSignal | undefined): Promise<WebSearchSource[]> {
    const url = new URL(this.options.wikipediaURL)
    url.searchParams.set('action', 'query')
    url.searchParams.set('list', 'search')
    url.searchParams.set('format', 'json')
    url.searchParams.set('srlimit', String(Math.min(Math.max(limit, 1), 20)))
    url.searchParams.set('srsearch', query)
    const response = await this.get(url, 'application/json', signal, 'Wikipedia')
    if (!response.ok) {
      await response.body?.cancel()
      throw new WebError(`Wikipedia search answered HTTP ${String(response.status)}`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return parseWikipediaResults(await response.json())
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Wikipedia search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Wikipedia returned an unreadable body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}
