/**
 * Laya decision plugin. Ships with GhostCode in the `not-installed` state; the
 * user's Install click fetches `laya[serve]` into `<home>/laya/.venv`, and the
 * composer brain button starts or stops a loopback `laya-serve` sidecar.
 * While it runs, two hooks ask Laya yes/no questions: whether a stopping turn
 * is really done, and whether a shell command succeeded. Every decision is
 * logged to memory and to `<home>/laya/decisions.jsonl`. With Laya off,
 * missing or slow, both hooks do nothing.
 * @module @deepseek-ai/dsh-laya
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { askNoul } from './client.ts'
import { LayaController } from './controller.ts'
import { DecisionLog } from './decisions.ts'
import {
  decideCommand, decideStop, FAILURE_NOTE, isCommandTool, stopState, textOf, VERIFY_NUDGE, type Ask,
} from './hooks.ts'
import { LayaSidecar } from './sidecar.ts'
import { installAutoContinue } from './auto-continue.ts'

export { LayaController } from './controller.ts'
export type { LayaDecision, LayaProgress, LayaState, LayaStatusView } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    laya: { kind: 'laya' } & ContextFormed
  }
}

const SOURCE: MessageSource = { kind: 'laya' }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'laya'

/** Live plugin settings. */
export interface Config {
  enabled: Volatile<boolean>
  stopThreshold: Volatile<number>
  commandThreshold: Volatile<number>
  timeoutMs: Volatile<number>
}

export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  stopThreshold: z.number().min(0).max(1).default(0.5).volatile(),
  commandThreshold: z.number().min(0).max(1).default(0.3).volatile(),
  timeoutMs: z.number().min(50).default(800).volatile(),
})

/**
 * Mount the sidecar owner, the Remote controller and both hooks.
 * @param ctx - Host context.
 * @param config - live settings.
 */
export function apply(ctx: Context, config: Config): void {
  const root = dshHomePath('laya')
  const sidecar = new LayaSidecar(root, ctx.logger)
  const log = new DecisionLog(dshHomePath('laya', 'decisions.jsonl'))
  const save = async (enabled: boolean): Promise<void> => {
    const entry = ctx.fiber.entry
    const editor = ctx.get('configEditor')
    if (entry === undefined || editor === undefined) return
    await editor.edit(entry, current => ({ ...current, enabled }))
  }
  new LayaController(ctx, sidecar, log, save)

  if (config.enabled.get() && sidecar.installed()) void sidecar.start()
  ctx.effect(() => () => { sidecar.stop() }, 'laya: sidecar')

  const ask: Ask = async (state, question) => {
    const endpoint = sidecar.endpoint
    if (sidecar.state !== 'on' || endpoint === undefined) return undefined
    return await askNoul(endpoint, state, question, config.timeoutMs.get())
  }
  const nudged = new Set<string>()
  // A reply cut off at the output limit is continued before Laya judges it; Laya skips that stop.
  const continued = new Set<string>()
  installAutoContinue(ctx, SOURCE, continued)

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    if (sidecar.state !== 'on') return
    const key = `${agent.session.id}:${String(turn)}`
    if (continued.has(key)) return
    const messages = agent.session.deriveMessages()
    const request = messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const reply = messages.findLast(message => message.role === 'assistant')
    if (request === undefined || reply === undefined) return
    const decision = await decideStop(ask, stopState(textOf(request.content), textOf(reply.content)),
      config.stopThreshold.get(), nudged.has(key))
    if (decision === undefined) return
    log.record({ ...decision, time: Date.now(), sessionId: String(agent.session.id) })
    if (decision.action !== 'continue') return
    nudged.add(key)
    agent.steer(createUserMessage({ content: [{ type: 'text', text: VERIFY_NUDGE }], source: SOURCE }))
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (sidecar.state !== 'on' || !isCommandTool(exec.name)) return downstream
    const decision = await decideCommand(ask, `${exec.name} ${JSON.stringify(exec.arguments)}`,
      textOf(result.content), config.commandThreshold.get())
    if (decision === undefined) return downstream
    log.record({
      ...decision,
      time: Date.now(),
      ...exec.agent === undefined ? {} : { sessionId: String(exec.agent.session.id) },
    })
    if (decision.action !== 'flag-failure') return downstream
    const note = createUserMessage({ content: [{ type: 'text', text: FAILURE_NOTE }], source: SOURCE })
    return { ...downstream, additionalContexts: [...downstream.additionalContexts ?? [], note] }
  })
}
