import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Ghost silhouette with a wavy hem and two eyes cut out (24 x 24 grid). */
export const GHOST_PATH =
  'M12 2C7.58 2 4 5.58 4 10v11.2c0 .62.73.95 1.2.55L7 20.2l1.8 1.55c.3.26.74.26 1.04 0L12 20.2l2.16 1.55c.3.26.74.26 1.04 0L17 20.2l1.8 1.55c.47.4 1.2.07 1.2-.55V10c0-4.42-3.58-8-8-8Z'
  + 'M9 8.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'
  + 'M15 8.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'

/**
 * Render the GhostCode mark at a square size.
 * @param props - size in pixels and an optional host class.
 * @returns the ghost svg.
 */
export function GhostMark({ size, className }: { size: number, className?: string | undefined }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d={GHOST_PATH} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  )
}

/**
 * Sidebar brand mark occupant.
 * @param props - host-requested size.
 * @returns the ghost mark.
 */
export function GhostSidebarMark({ size }: SidebarBrandMarkOwnerProps) {
  return <GhostMark size={size} />
}

/**
 * Sidebar brand name occupant.
 * @returns the GhostCode wordmark as text.
 */
export function GhostSidebarName() {
  return (
    <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
      GhostCode
    </span>
  )
}

/**
 * Blank-session hero mark occupant.
 * @param props - host-requested size and class.
 * @returns the ghost mark.
 */
export function GhostHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <GhostMark size={size} className={className} />
}
