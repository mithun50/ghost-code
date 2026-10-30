/**
 * A short system prompt and slim tool declarations for small local models.
 * The full harness prompt plus its tool schemas is about 9.7K tokens, which a
 * laptop CPU needs 10 to 30 seconds to read before the first token. Cloud
 * models keep the full prompt; only the built-in local route gets this one.
 */

import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'

/** The complete system prompt local models receive. Stable text, so the server's prompt cache hits. */
export const LOCAL_PROMPT = [
  'You are GhostCode, a coding agent running on a local model on the user\'s own machine, fully offline.',
  'Work in the current working directory. Act with the tools; never just describe what you would do.',
  'How to work:',
  '- Read a file before you edit it. Create files with write, change them with edit.',
  '- Run commands with pwsh on Windows, bash elsewhere. A non-zero [exit code: N] means it failed: read the error, fix it, run again.',
  '- After writing code, check it once (for example node --check script.js), then fix what is broken.',
  '- Never print or copy secrets from .env, key or credential files.',
  'Building websites and apps:',
  '- Plain HTML, CSS and JavaScript unless asked otherwise: index.html, styles.css, script.js, linked with relative paths.',
  '- Semantic HTML: header, nav, main, section, footer. Write real, specific text, never lorem ipsum.',
  'Design: simple, minimal, clean and professional. When unsure, leave it out.',
  '- Plenty of white space. One column or a simple grid, content in a centered container, max-width 1100px.',
  '- Colors: a white or near-white background, near-black text (#111), gray for secondary text, one muted accent color. Solid colors only.',
  '- Never use gradients, neon, glow, glassmorphism, heavy shadows or decorative blobs. Borders are 1px light gray; shadows, if any, are subtle.',
  '- Type: system-ui font stack, 16px body, line-height 1.6, at most three heading sizes, regular and semibold weights only.',
  '- Spacing on an 8px scale (8, 16, 24, 32, 48, 64). Align everything to it.',
  '- Buttons: solid accent or a plain outline, 6px radius, clear hover and focus states.',
  '- Mobile first, one breakpoint at 768px. Images use max-width: 100%.',
  '- Motion only where it helps: short transitions of 150 to 250 ms. Respect prefers-reduced-motion.',
  '- PWA when asked: manifest.json (name, start_url, display standalone, theme_color, icons) and a service worker that caches the app shell, registered from script.js.',
  '- No emojis anywhere. No em or en dashes in any text; use commas or periods.',
  'Keep replies short. When done, say what you built and how to open it in one or two sentences.',
].join('\n')

/** Tools local models keep. Web search is left out: small models loop on it instead of writing code. */
export const LITE_TOOLS: readonly string[] = ['read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'bash', 'job_output', 'job_list', 'job_kill']

const MAX_DESCRIPTION = 280
const MAX_PARAM_DESCRIPTION = 140
const PARAGRAPH = /\n\s*\n/
const SPACE = /\s+/g

/**
 * Shorten a description to its first paragraph, cut at a sentence end.
 * @param text - the full description.
 * @param max - longest allowed result.
 * @returns a deterministic short form, so cached prompts stay identical.
 */
export function slimDescription(text: string, max = MAX_DESCRIPTION): string {
  const first = (text.split(PARAGRAPH)[0] ?? text).replace(SPACE, ' ').trim()
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  const end = cut.lastIndexOf('. ')
  return end > Math.min(80, max / 2) ? cut.slice(0, end + 1) : `${cut.trimEnd()}...`
}

/** Shorten every `description` inside a JSON schema; types, names and required lists stay. */
function slimSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slimSchema)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'description' && typeof entry === 'string' ? slimDescription(entry, MAX_PARAM_DESCRIPTION) : slimSchema(entry),
  ]))
}

/**
 * Keep only the lite tools, with short descriptions. Parameter types are
 * unchanged, so every call the model makes still validates against the real schema.
 * @param tools - declarations the loop would send.
 * @returns the slim declarations; all tools when none of them is a lite tool.
 */
export function slimTools(tools: readonly ToolSchema[]): ToolSchema[] {
  const lite = tools.filter(tool => LITE_TOOLS.includes(tool.name))
  return (lite.length > 0 ? lite : tools).map(tool => ({
    ...tool,
    description: slimDescription(tool.description),
    parameters: slimSchema(tool.parameters) as Record<string, unknown>,
  }))
}

/**
 * The request a local model receives: the short prompt in place of the leading
 * system message, slim tools, and no tool-update history.
 * @param options - the loop's request, left unchanged.
 * @returns a new request.
 */
export function slimLocalRequest(options: GenerateOptions): GenerateOptions {
  let replaced = false
  const messages = options.messages.map((message) => {
    if (replaced || message.role !== 'system') return message
    replaced = true
    return { ...message, content: [{ type: 'text' as const, text: LOCAL_PROMPT }] } as typeof message
  })
  const copy: GenerateOptions = { ...options, messages }
  delete copy.toolHistory
  if (copy.system !== undefined) copy.system = LOCAL_PROMPT
  if (options.tools !== undefined) copy.tools = slimTools(options.tools)
  return copy
}
