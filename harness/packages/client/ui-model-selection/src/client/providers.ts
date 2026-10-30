/** Provider presets and route helpers for the composer's model setup flow. */

/** Wire protocols a hand-declared route may name, in the adapter's order. */
export const SETUP_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

/** One wire protocol id. */
export type SetupProtocol = typeof SETUP_PROTOCOLS[number]

/** One cloud provider the BYOK grid offers. */
export interface ProviderPreset {
  /** Route id the provider is saved under. */
  readonly route: string
  readonly name: string
  readonly api: SetupProtocol
  readonly baseURL: string
  /** Where the user creates a key. */
  readonly keyUrl: string
}

/**
 * Cloud presets from docs/research/R8-byok-providers.md. Gemini and Mistral are
 * saved as declared routes speaking their OpenAI-compatible endpoints, so the
 * installed catalog's native protocols for those ids never apply.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { route: 'openai', name: 'OpenAI', api: 'openai-responses', baseURL: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { route: 'anthropic', name: 'Anthropic', api: 'anthropic-messages', baseURL: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { route: 'google-gemini', name: 'Google Gemini', api: 'openai-completions', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { route: 'openrouter', name: 'OpenRouter', api: 'openai-completions', baseURL: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { route: 'groq', name: 'Groq', api: 'openai-completions', baseURL: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { route: 'deepseek', name: 'DeepSeek', api: 'openai-completions', baseURL: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { route: 'mistral-ai', name: 'Mistral', api: 'openai-completions', baseURL: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { route: 'xai', name: 'xAI', api: 'openai-responses', baseURL: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  { route: 'together', name: 'Together AI', api: 'openai-completions', baseURL: 'https://api.together.ai/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { route: 'fireworks', name: 'Fireworks', api: 'openai-completions', baseURL: 'https://api.fireworks.ai/inference/v1', keyUrl: 'https://app.fireworks.ai/settings/users/api-keys' },
  { route: 'cerebras', name: 'Cerebras', api: 'openai-completions', baseURL: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai' },
  { route: 'perplexity', name: 'Perplexity', api: 'openai-completions', baseURL: 'https://api.perplexity.ai/orchestrator/v1', keyUrl: 'https://www.perplexity.ai/account/api/keys' },
  { route: 'cohere', name: 'Cohere', api: 'openai-completions', baseURL: 'https://api.cohere.ai/compatibility/v1', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { route: 'moonshotai', name: 'Moonshot Kimi', api: 'openai-completions', baseURL: 'https://api.moonshot.ai/v1', keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { route: 'zai', name: 'Z.ai GLM', api: 'openai-completions', baseURL: 'https://api.z.ai/api/paas/v4', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  { route: 'dashscope', name: 'Qwen DashScope', api: 'openai-completions', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://modelstudio.console.alibabacloud.com' },
  { route: 'nebius', name: 'Nebius', api: 'openai-completions', baseURL: 'https://api.tokenfactory.nebius.com/v1', keyUrl: 'https://tokenfactory.nebius.com' },
  { route: 'huggingface', name: 'Hugging Face', api: 'openai-completions', baseURL: 'https://router.huggingface.co/v1', keyUrl: 'https://huggingface.co/settings/tokens' },
  { route: 'nvidia', name: 'NVIDIA NIM', api: 'openai-completions', baseURL: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com' },
  { route: 'sambanova', name: 'SambaNova', api: 'openai-completions', baseURL: 'https://api.sambanova.ai/v1', keyUrl: 'https://cloud.sambanova.ai/apis' },
]

/** One keyless local runtime the Local tab probes. */
export interface LocalRuntime {
  readonly route: string
  readonly name: string
  readonly baseURL: string
  readonly downloadUrl: string
}

/** Local runtimes probed on the Local tab. */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
  { route: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', downloadUrl: 'https://ollama.com/download' },
  { route: 'lmstudio', name: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1', downloadUrl: 'https://lmstudio.ai' },
]

/** A route id usable as a settings key and as a credential-name stem. */
export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Derive the conventional credential reference for a route.
 * @param route - provider route id.
 * @returns the reference name, for example `GROQ_API_KEY`.
 */
export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Turn a display name into a route id candidate.
 * @param name - user-typed display name.
 * @returns a lowercase hyphenated slug; may still fail {@link ROUTE_PATTERN}.
 */
export function slugRoute(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Whether a value parses as an http(s) URL.
 * @param value - candidate base URL.
 * @returns true for http and https URLs.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Two-letter monogram for a provider card.
 * @param name - provider display name.
 * @returns up to two uppercase letters.
 */
export function monogram(name: string): string {
  const words = name.split(/[\s.-]+/).filter(word => word.length > 0)
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2)
  return letters.toUpperCase()
}
