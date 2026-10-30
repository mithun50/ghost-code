# @deepseek-ai/dsh-web-search-duckduckgo

## Summary

A keyless `WebSearchProvider` for the `ctx.web` seam. It reads the DuckDuckGo
Lite results page and falls back to the Wikipedia search API when DuckDuckGo
returns no results or a non-200 status. It needs no credential, so `web_search`
works the same with a cloud (BYOK) model and a local model.

## Use this package

```yaml
- id: web-search-duckduckgo
  name: '@deepseek-ai/dsh-web-search-duckduckgo'
```

Optional config: `liteURL`, `wikipediaURL` (empty disables the fallback), and
`userAgent`. Requests send an honest product `User-Agent`, never a browser one.

## Known Limitations and Deferred Work

DuckDuckGo may answer automated requests with a bot check (HTTP 202 and an
empty page). The provider then returns Wikipedia results, which cover
encyclopedic topics but not current release notes or documentation pages.
