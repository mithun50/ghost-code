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

function registerSeat(ctx: Context): void {
  const ops: LayaOperations = {
    status: () => settle(ctx.remote.laya.status()),
    install: () => settle(ctx.remote.laya.install()),
    enable: () => settle(ctx.remote.laya.enable()),
    disable: () => settle(ctx.remote.laya.disable()),
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-laya: dictionaries')
  const Seat = ({ t }: PropsLocale<'laya'>) => createElement(LayaToggle, { ops, t })
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'laya', order: 0, locale: NS,
  }, Seat))
}
