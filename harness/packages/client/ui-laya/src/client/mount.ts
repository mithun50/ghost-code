/** Mount the Laya Remote, then register the composer brain button and its copy. */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-laya/remote'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-local-models/remote'
import { GuardPanel, type GuardOperations } from './GuardPanel.tsx'
import { LayaToggle, type LayaOperations, type LayaView } from './LayaToggle.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type LayaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { laya: LayaKey }
}

const NS = 'laya'

/** Services the button needs. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Mount the generated Remote, then register the seat for the same plugin lifetime.
 * @param ctx - Client plugin context.
 * @param contribution - generated `laya` Remote descriptors.
 * @returns disposer removing the seat before the Remote.
 */
export async function mountLaya(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution)
  const seat = ctx.inject(['remote.laya'], registerSeat)
  try { await seat } catch (error) { await seat.dispose(); await unmount(); throw error }
  return async () => { await seat.dispose(); await unmount() }
}

/** Fold a Remote outcome into the view or its failure message. */
async function settle(call: Promise<RemoteResult<LayaView>>): Promise<LayaView | string> {
  try {
    const result = await call
    return result.ok ? result.value : result.error.message
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Fold any Remote outcome into its value or its failure message. */
async function settleAny<T>(call: Promise<RemoteResult<T>>): Promise<T | string> {
  try {
    const result = await call
    return result.ok ? result.value : result.error.message
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Register the privacy shield once the built-in local models Remote is mounted
 * (ui-model-selection mounts it; a Host without the plugin never shows the shield).
 * @param ctx - Client plugin context.
 */
function registerGuard(ctx: Context): void {
  const ops: GuardOperations = {
    guard: () => settleAny(ctx.remote.localModels.guardStatus('')),
    egress: limit => settleAny(ctx.remote.localModels.egressLog(limit, '')),
    setPolicy: (cloud, escalateTo) => settleAny(ctx.remote.localModels.setGuardPolicy(cloud, escalateTo)),
    decisions: limit => settleAny(ctx.remote.laya.decisions(limit)),
  }
  const Seat = ({ t }: PropsLocale<'laya'>) => createElement(GuardPanel, { ops, t })
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'ghostcode-guard', order: -1, locale: NS,
  }, Seat))
}

function registerSeat(ctx: Context): void {
  ctx.inject(['remote.localModels'], registerGuard)
  const ops: LayaOperations = {
    decisions: limit => settleAny(ctx.remote.laya.decisions(limit)),
    status: () => settle(ctx.remote.laya.status()),
    install: () => settle(ctx.remote.laya.installLaya()),
    enable: () => settle(ctx.remote.laya.enable()),
    disable: () => settle(ctx.remote.laya.disable()),
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-laya: dictionaries')
  const Seat = ({ t }: PropsLocale<'laya'>) => createElement(LayaToggle, { ops, t })
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'laya', order: 0, locale: NS,
  }, Seat))
}
