import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  decodeEntities,
  DuckDuckGoSearchProvider,
  DUCKDUCKGO_PROVIDER_ID,
  GHOSTCODE_USER_AGENT,
  parseLiteResults,
  parseWikipediaResults,
  resolveResultUrl,
} from '../src/provider.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const options = {
  liteURL: 'https://lite.duckduckgo.test/lite/',
  wikipediaURL: 'https://wiki.test/w/api.php',
  userAgent: GHOSTCODE_USER_AGENT,
}

const wikipediaBody = {
  query: {
    search: [
      { title: 'Vite (software)', snippet: '<span class="searchmatch">Vite</span> is a build tool', timestamp: '2026-10-01T00:00:00Z' },
    ],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DuckDuckGo Lite parsing', () => {
  it('parses every result of the recorded page with decoded target URLs', () => {
    const sources = parseLiteResults(fixture('lite-results.html'))
    expect(sources).toHaveLength(10)
    expect(sources[0]).toMatchObject({ url: 'https://vite.dev/releases', title: 'Releases | Vite' })
    expect(sources[0]?.snippet).toContain('The supported version ranges')
    for (const source of sources) expect(source.url).toMatch(/^https?:\/\//)
  })

  it('finds no results on the bot-check page', () => {
    expect(parseLiteResults(fixture('lite-challenge.html'))).toEqual([])
  })

  it('resolves redirect links and rejects non-http targets', () => {
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fx&amp;rut=1')).toBe('https://a.test/x')
    expect(resolveResultUrl('https://b.test/y')).toBe('https://b.test/y')
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)')).toBeUndefined()
  })

  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &#39;c&#x27; &lt;d&gt; &nbsp;')).toBe('a & b \'c\' <d>  ')
  })
})

describe('Wikipedia fallback parsing', () => {
  it('maps hits to article URLs with plain snippets', () => {
    expect(parseWikipediaResults(wikipediaBody)).toEqual([{
      url: 'https://en.wikipedia.org/wiki/Vite_(software)',
      title: 'Vite (software)',
      snippet: 'Vite is a build tool',
      publishedAt: '2026-10-01T00:00:00Z',
    }])
  })

  it('tolerates an empty or malformed body', () => {
    expect(parseWikipediaResults({})).toEqual([])
    expect(parseWikipediaResults(null)).toEqual([])
  })
})

describe('DuckDuckGoSearchProvider', () => {
  it('is available with no credential', () => {
    const provider = new DuckDuckGoSearchProvider(options)
    expect(provider.id).toBe(DUCKDUCKGO_PROVIDER_ID)
    expect(provider.available()).toBe(true)
  })

  it('returns DuckDuckGo results bounded by maxResults with an honest User-Agent', async () => {
    const fetchMock = vi.fn(async () => new Response(fixture('lite-results.html'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new DuckDuckGoSearchProvider(options).search({ query: 'vite latest version', maxResults: 3 })
    expect(result.sources).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.searchParams.get('q')).toBe('vite latest version')
    expect((init.headers as Record<string, string>)['user-agent']).toBe(GHOSTCODE_USER_AGENT)
  })

  it('falls back to Wikipedia when DuckDuckGo answers the bot check', async () => {
    const fetchMock = vi.fn(async (url: URL) => url.hostname === 'wiki.test'
      ? new Response(JSON.stringify(wikipediaBody), { status: 200 })
      : new Response(fixture('lite-challenge.html'), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new DuckDuckGoSearchProvider(options).search({ query: 'vite' })
    expect(result.sources[0]?.title).toBe('Vite (software)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports WEB_PROVIDER_ERROR when both backends fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'x' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('reports WEB_ABORTED without trying the fallback', async () => {
    const fetchMock = vi.fn(async () => { throw new DOMException('aborted', 'AbortError') })
    vi.stubGlobal('fetch', fetchMock)
    const error = await new DuckDuckGoSearchProvider(options).search({ query: 'x' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WebError)
    expect((error as WebError).code).toBe('WEB_ABORTED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
