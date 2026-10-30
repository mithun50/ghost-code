/**
 * Local models plugin. Scans the machine, offers pinned GGUF models, installs
 * llama.cpp and a model on the user's click, and runs one loopback
 * `llama-server` for the `ghostcode-local` route. The server starts on demand
 * and stops with the Host.
 *
 * The same plugin owns the "never leak, verify before escalating" guard
 * (see `guard.ts`): it cleans every cloud request, blocks secret files while
 * a cloud model is active, escalates only on failed-command evidence, and
 * recovers from low memory or a crashed server locally.
 * @module @deepseek-ai/dsh-local-models
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { freemem } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { createUserMessage, isAgentLoopRequest, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, LlmRuntime, MessageSource, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { CATALOG, catalogModel } from './catalog.ts'
import { LocalModelsController, type GuardHub } from './controller.ts'
import { cleanRequest, EgressLog, isLocalProvider, judgeCommand, SessionGuard } from './guard.ts'
import { sensitiveTarget } from './egress.ts'
import { LITE_TOOLS, slimLocalRequest } from './local-prompt.ts'
import { LocalModelManager } from './server.ts'
import { WEIGHT_SHARE } from './system.ts'
import type { GuardView } from './types.ts'

export { LocalModelsController } from './controller.ts'
export { CATALOG } from './catalog.ts'
export { cleanRequest, judgeCommand } from './guard.ts'
export { redactText, sensitiveTarget } from './egress.ts'
export type {
  DownloadProgress, EgressEntry, EvidenceCheck, GuardTotals, GuardView, LocalModelView, LocalStatusView, ModelFit,
  RuntimeView, ServerView, SystemInfo,
} from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'local-guard': { kind: 'local-guard' } & ContextFormed
  }
}

const SOURCE: MessageSource = { kind: 'local-guard' }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'local-models'

/** Model route id the setup modal saves for the built-in server. */
export const LOCAL_ROUTE = 'ghostcode-local'

/** Plugin settings. */
export interface Config {
  port: number
  preload: boolean
  escalateAfter: number
  lowMemoryMb: number
}

export const Config = z.object({
  port: z.natural().max(65535).default(Number(process.env['GHOSTCODE_LOCAL_PORT'] ?? '') || 18434),
  preload: z.boolean().default(true),
  escalateAfter: z.natural().min(1).default(3),
  lowMemoryMb: z.natural().default(700),
})

/** Tools local models keep: enough to code, build and run, with a prompt short enough to start fast. */
const COMMAND_TOOL = /pwsh|bash|shell|exec|command/i

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.map(block => (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
    ? String((block as { text?: unknown }).text ?? '') : '')).filter(Boolean).join('\n')
}

function note(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: SOURCE })
}

interface StoredPolicy { cloud: 'allow' | 'block', escalateTo: string }

/**
 * Mount the manager, the guard, its Remote and every hook.
 * @param ctx - Host context.
 * @param config - settings.
 */
export function apply(ctx: Context, config: Config): void {
  const root = dshHomePath('local-models')
  const manager = new LocalModelManager(root, config.port, ctx.logger)
  const log = new EgressLog(join(root, 'egress.jsonl'))
  const policyFile = join(root, 'guard.json')
  let policy: StoredPolicy = { cloud: 'allow', escalateTo: '' }
  try { policy = { ...policy, ...JSON.parse(readFileSync(policyFile, 'utf8')) as Partial<StoredPolicy> } } catch { /* defaults */ }
  const guards = new Map<string, SessionGuard>()
  const guardOf = (sessionId: string): SessionGuard => {
    let guard = guards.get(sessionId)
    if (guard === undefined) { guard = new SessionGuard(); guards.set(sessionId, guard) }
    return guard
  }
  let lastSession: { id: string, agent: Agent } | undefined
  const localRetries = new Map<string, number>()
  const liteTools = new WeakMap<Agent, () => void>()

  const hub: GuardHub & { ensureRoute?: () => Promise<void> } = {
    view(sessionId): GuardView {
      const registry = ctx.get('agents') as { get(id: string): Agent | undefined } | undefined
      const id = sessionId ?? lastSession?.id
      const agent = id === undefined ? undefined : registry?.get(id) ?? (id === lastSession?.id ? lastSession.agent : undefined)
      const selection = agent?.model.current()
      const guard = id === undefined ? new SessionGuard() : guardOf(id)
      const laya = (ctx.get('layaController') as { status?: () => { state?: string } } | undefined)?.status?.().state
      return {
        route: selection === undefined ? 'none' : isLocalProvider(selection.provider) ? 'local' : 'cloud',
        ...selection === undefined ? {} : { provider: selection.provider, model: selection.model },
        cloudPolicy: policy.cloud,
        escalateTo: policy.escalateTo,
        escalateAfter: config.escalateAfter,
        totals: guard.totals(),
        checks: [...guard.checks].slice(-8),
        freeRam: freemem(),
        ...laya === undefined ? {} : { laya },
      }
    },
    egress: (limit, sessionId) => log.list(limit, sessionId ?? lastSession?.id),
    setPolicy(next) {
      policy = { ...policy, ...next }
      try { writeFileSync(policyFile, JSON.stringify(policy, null, 2)) } catch { /* kept in memory */ }
    },
  }
  /** Write the GhostCode Local route listing every installed model, so it shows in the model menu. */
  const ensureRoute = async (): Promise<void> => {
    const settings = ctx.get('settings') as {
      describe(options: { redactSecrets: boolean }): Array<{ ns: string, value: unknown }>
      mutate(ns: string, ops: unknown[]): Promise<void>
    } | undefined
    if (settings === undefined) return
    const installed = CATALOG.filter(model => manager.installed(model))
    if (installed.length === 0) return
    const current = settings.describe({ redactSecrets: true }).find(entry => entry.ns === 'llm-pi-ai')?.value as
      { providers?: Record<string, { baseURL?: string, models?: Array<{ id?: string }> }> } | undefined
    const route = current?.providers?.[LOCAL_ROUTE]
    const ids = new Set((route?.models ?? []).map(model => model.id))
    if (route?.baseURL === manager.baseURL && ids.size === installed.length && installed.every(model => ids.has(model.id))) return
    const profile = {
      displayName: 'GhostCode Local',
      api: 'openai-completions',
      baseURL: manager.baseURL,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
      models: installed.map(model => ({
        id: model.id,
        name: `${model.name} (${model.bits}, local)`,
        contextWindow: model.contextWindow,
        maxTokens: Math.min(8192, Math.floor(model.contextWindow / 2)),
        reasoningEfforts: false,
      })),
    }
    try {
      await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', LOCAL_ROUTE], value: profile }])
      ctx.logger.info(`local-models: listed ${String(installed.length)} local model(s) in the model menu`)
    } catch (error: unknown) {
      ctx.logger.warn(`local-models: could not list local models in the model menu: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  hub.ensureRoute = ensureRoute
  new LocalModelsController(ctx, manager, hub)
  ctx.effect(() => () => { manager.stop() }, 'local-models: server')

  // Load the best installed model in the background, so the first message does not wait for the load.
  if (config.preload) {
    const timer = setTimeout(() => {
      void ensureRoute()
      const best = CATALOG.filter(model => manager.installed(model) && model.size <= freemem() * WEIGHT_SHARE)
        .sort((a, b) => b.rank - a.rank)[0]
      if (best !== undefined && manager.server.state === 'stopped') void manager.start(best.id)
    }, 2000)
    ctx.effect(() => () => { clearTimeout(timer) }, 'local-models: preload')
  }

  /** The cloud model to escalate to: the configured one, else the first configured cloud route. */
  const escalationTarget = async (): Promise<{ provider: string, model: string } | undefined> => {
    const slash = policy.escalateTo.indexOf('/')
    if (slash > 0) return { provider: policy.escalateTo.slice(0, slash), model: policy.escalateTo.slice(slash + 1) }
    const llm = ctx.get('llm') as LlmRuntime | undefined
    for (const provider of llm?.listProviders() ?? []) {
      if (isLocalProvider(provider.id)) continue
      try {
        const models = await llm!.listModels(provider.id)
        if (models[0] !== undefined) return { provider: provider.id, model: models[0].id }
      } catch { /* try the next route */ }
    }
    return undefined
  }

  const setLiteTools = (agent: Agent, on: boolean): void => {
    const lifted = liteTools.get(agent)
    if (!on) { if (lifted !== undefined) { lifted(); liteTools.delete(agent) } return }
    if (lifted !== undefined) return
    try {
      const tools = agent.ctx.tools
      const known = new Set(tools.definitions().map(tool => tool.name))
      const allow = LITE_TOOLS.filter(tool => known.has(tool))
      if (allow.length > 0) liteTools.set(agent, tools.restrict({ allow }))
    } catch (error: unknown) {
      ctx.logger.warn(`local-models: could not trim tools for the local model: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`[local-models] tool trim failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // The loop fixes a step's tools before pre-step runs, so trim at creation too; the first local step then sends the short prompt.
  ctx.on('agent/created', ({ agent }) => {
    const selection = agent.model.current()
    setLiteTools(agent, selection?.provider === LOCAL_ROUTE && catalogModel(selection.model) !== undefined)
    return undefined
  })

  // Before each step: start the local server, trim tools, and recover from low memory locally.
  ctx.on('agent/pre-step', async (payload, next) => {
    const { agent, modelSelection: selection } = payload
    const sessionId = String(agent.session.id)
    lastSession = { id: sessionId, agent }
    localRetries.delete(sessionId)
    const local = selection.provider === LOCAL_ROUTE ? catalogModel(selection.model) : undefined
    setLiteTools(agent, local !== undefined)
    if (local === undefined) return await next()
    const serving = manager.server.state === 'running' && manager.server.model === local.id
    const free = freemem()
    // Weights may take WEIGHT_SHARE of free memory; a running model already counts as used.
    const room = (free + (serving ? local.size : 0)) * WEIGHT_SHARE
    let target = local
    if (local.size > room || (serving && free < config.lowMemoryMb * 1_048_576)) {
      // Only models the route actually lists can be selected; the model switch fails otherwise.
      const llm = ctx.get('llm') as LlmRuntime | undefined
      const listed = new Set((await llm?.listModels(LOCAL_ROUTE).catch(() => []) ?? []).map(model => model.id))
      const smaller = CATALOG.filter(model => manager.installed(model) && listed.has(model.id) && model.size < local.size && model.size <= room)
        .sort((a, b) => b.size - a.size)[0]
      if (smaller !== undefined) {
        target = smaller
        guardOf(sessionId).recoveries++
        log.write({ time: Date.now(), sessionId, kind: 'local-recovery', provider: LOCAL_ROUTE, model: smaller.id,
          detail: `Low memory (${String(Math.round(free / 1_048_576))} MB free): moved from ${local.name} to ${smaller.name} locally instead of escalating to the cloud.` })
        agent.model.select({ provider: LOCAL_ROUTE, model: smaller.id })
      }
    }
    await manager.start(target.id)
    if (manager.server.state !== 'running') {
      throw new Error(`The local model ${target.name} could not start: ${manager.server.error ?? 'unknown error'}. `
        + 'GhostCode paused this task instead of sending it to the cloud. Free some memory or pick a smaller local model, then send again.')
    }
    return await next()
  })

  // Every request to a cloud route is cleaned first, or blocked in privacy mode. Local requests pass untouched.
  const cleaned = new WeakSet<GenerateOptions>()
  ctx.on('llm/stream', function (this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    // The built-in local model gets a short prompt and slim tools, so its first token comes fast.
    if (options.provider === LOCAL_ROUTE && !cleaned.has(options)) {
      const copy = slimLocalRequest(options)
      if (isAgentLoopRequest(options)) markAgentLoopRequest(copy)
      cleaned.add(copy)
      return this.stream(copy)
    }
    if (cleaned.has(options) || isLocalProvider(options.provider)) {
      if (options.provider !== LOCAL_ROUTE || manager.warmSaved) return next()
      // Keep the first local prompt's cache on disk so the next server start answers in seconds.
      return (async function* (): AsyncIterable<StreamChunk> {
        for await (const chunk of next()) yield chunk
        void manager.saveWarm()
      })()
    }
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    const guard = sessionId === undefined ? undefined : guardOf(sessionId)
    if (policy.cloud === 'block') {
      log.write({ time: Date.now(), ...sessionId === undefined ? {} : { sessionId }, kind: 'blocked-request', provider: options.provider, model: options.model,
        detail: 'Privacy mode is on: the request never left this machine.' })
      const failure = { message: 'GhostCode privacy mode blocks cloud requests. Pick a local model, or allow the cloud from the shield in the composer.', code: 'GHOSTCODE_CLOUD_BLOCKED' }
      return (async function* (): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'error', failure } } })()
    }
    const result = cleanRequest(options.messages, options.system)
    const copy = { ...options, messages: [...result.messages] } as GenerateOptions
    if (result.system !== undefined) copy.system = result.system
    if (isAgentLoopRequest(options)) markAgentLoopRequest(copy)
    cleaned.add(copy)
    if (guard !== undefined) {
      guard.cloudRequests++
      guard.bytesSent += result.bytes
      guard.secretsRemoved += result.found.length
      guard.filesWithheld += result.withheld.length
    }
    log.write({
      time: Date.now(), ...sessionId === undefined ? {} : { sessionId }, kind: 'cloud-request', provider: options.provider, model: options.model,
      bytes: result.bytes, files: result.files, secretsRemoved: result.found.length, secretKinds: [...new Set(result.found)], withheld: [...result.withheld],
    })
    return this.stream(copy)
  }, { prepend: true })

  // While a cloud model is active, secret files are not read at all.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const selection = exec.agent?.model.current()
    if (exec.agent !== undefined && selection !== undefined && !isLocalProvider(selection.provider)) {
      const target = sensitiveTarget(exec.arguments)
      if (target !== undefined) {
        const sessionId = String(exec.agent.session.id)
        guardOf(sessionId).blockedReads++
        log.write({ time: Date.now(), sessionId, kind: 'blocked-read', provider: selection.provider, model: selection.model, files: [target],
          detail: `${exec.name} on ${target} was denied while a cloud model is active.` })
        return { kind: 'deny', reason: `GhostCode blocked this call: ${target} holds secrets and the active model (${selection.provider}/${selection.model}) runs in the cloud. Secret files never leave this machine. Continue without it, or ask the user to switch to a local model.` }
      }
    }
    return await next()
  })

  // Escalate on evidence only: failed commands, counted per session. Laya breaks ties when output carries no exit code.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    const agent = exec.agent
    if (agent === undefined || !COMMAND_TOOL.test(exec.name)) return downstream
    const sessionId = String(agent.session.id)
    const guard = guardOf(sessionId)
    let verdict = judgeCommand(result.isError, textOf(result.content))
    // Laya's own source kind is declared in dsh-laya, which this package does not import.
    const layaFlagged = (downstream.additionalContexts ?? []).some(message => (message.source.kind as string) === 'laya')
    if (verdict.passed && verdict.reason !== 'exit code 0' && layaFlagged) verdict = { passed: false, reason: 'Laya judged the output a failure' }
    guard.record({ time: Date.now(), tool: exec.name, ...verdict })
    const selection = agent.model.current()
    let message: string | undefined
    if (verdict.passed && guard.escalatedFrom !== undefined && selection !== undefined && !isLocalProvider(selection.provider)) {
      const back = guard.escalatedFrom
      guard.escalatedFrom = undefined
      agent.model.select(back)
      log.write({ time: Date.now(), sessionId, kind: 'returned-local', provider: back.provider, model: back.model, detail: 'A check passed, so the session returned to the local model.' })
      message = `[GhostCode: the last check passed, so this session is back on the local model ${back.model}.]`
    } else if (!verdict.passed && selection !== undefined && isLocalProvider(selection.provider) && guard.streak >= config.escalateAfter && policy.cloud === 'allow') {
      const target = await escalationTarget()
      if (target !== undefined) {
        guard.escalatedFrom = { provider: selection.provider, model: selection.model }
        agent.model.select(target)
        const reasons = guard.checks.slice(-guard.streak).map(check => check.reason).join('; ')
        log.write({ time: Date.now(), sessionId, kind: 'escalated', provider: target.provider, model: target.model,
          detail: `${String(guard.streak)} failed checks in a row (${reasons}). Secrets are redacted before anything is sent.` })
        message = `[GhostCode: ${String(guard.streak)} checks failed in a row (${reasons}), so the next step goes to ${target.provider}/${target.model}. Secrets and secret files are removed before sending. Fix the failing command; the session returns to the local model when a check passes.]`
      }
    }
    return message === undefined ? downstream : { ...downstream, additionalContexts: [...downstream.additionalContexts ?? [], note(message)] }
  }, { prepend: true })

  // A crashed local server restarts locally; a rejected cloud key falls back to the local model.
  ctx.on('agent/request-error', async (payload, next) => {
    const { agent, provider, failure } = payload
    const sessionId = String(agent.session.id)
    if (provider === LOCAL_ROUTE) {
      const tries = localRetries.get(sessionId) ?? 0
      const selection = agent.model.current()
      if (tries < 2 && selection !== undefined && /fetch failed|ECONNREFUSED|ECONNRESET|socket|terminated|other side closed|connect/i.test(failure.message)) {
        localRetries.set(sessionId, tries + 1)
        guardOf(sessionId).recoveries++
        log.write({ time: Date.now(), sessionId, kind: 'local-recovery', provider, model: selection.model, detail: `The local server failed (${failure.message}); restarted it locally.` })
        await manager.start(selection.model)
        if (manager.server.state === 'running') return { kind: 'retry' }
      }
    } else if (!isLocalProvider(provider) && (failure.status === 401 || failure.status === 403)) {
      const fallback = CATALOG.filter(model => manager.installed(model) && model.draft !== undefined)[0]
        ?? CATALOG.filter(model => manager.installed(model)).sort((a, b) => b.rank - a.rank)[0]
      if (fallback !== undefined) {
        agent.model.select({ provider: LOCAL_ROUTE, model: fallback.id })
        log.write({ time: Date.now(), sessionId, kind: 'local-recovery', provider: LOCAL_ROUTE, model: fallback.id,
          detail: `The ${provider} key was rejected (HTTP ${String(failure.status)}); switched to ${fallback.name}.` })
        agent.followup(note(`[GhostCode: the ${provider} key was rejected (HTTP ${String(failure.status)}), so this session moved to the local model ${fallback.name}. Continue the task.]`))
      }
    }
    return await next()
  })
}
