/** Bind the generated Laya Remote contribution to the browser lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-laya/remote'
import { mountLaya } from './mount.ts'
export { inject } from './mount.ts'
export { LayaToggle } from './LayaToggle.tsx'
export type { LayaOperations, LayaToggleProps, LayaView } from './LayaToggle.tsx'

/**
 * Mount the brain button and its Remote. Laya is optional, so a failed mount
 * (for example a Host without the Laya plugin) logs and leaves the rest of the
 * app running instead of failing the whole web boot.
 * @param ctx - Client plugin context.
 * @returns disposer for both contributions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try {
    return await mountLaya(ctx, remote)
  } catch (error: unknown) {
    console.error('ui-laya: Laya is unavailable, the brain button is hidden', error)
    return async () => {}
  }
}
