import { useEffect, useId, useRef, useState } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Rounded ghost body with a soft wavy hem (24 x 24 grid). */
export const GHOST_PATH =
  'M12 2.5C7.6 2.5 4.5 5.8 4.5 10.2v9.3c0 .9 1 1.4 1.7.8l1.3-1.1 1.4 1.2c.5.4 1.2.4 1.7 0L12 19.2l1.4 1.2c.5.4 1.2.4 1.7 0l1.4-1.2 1.3 1.1c.7.6 1.7.1 1.7-.8v-9.3C19.5 5.8 16.4 2.5 12 2.5Z'

const EYES = [{ cx: 9.3, cy: 10.2 }, { cx: 14.7, cy: 10.2 }] as const

/** Hero scale relative to the size the headline slot requests (1 keeps the original 34px). */
const HERO_SCALE = 1
/** Furthest the eyes travel toward the pointer, in grid units. */
const LOOK_TRAVEL = 0.8
/** Strongest tilt toward the pointer, in degrees. */
const MAX_TILT = 22

const HERO_KEYFRAMES = `
@keyframes gc-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6%) } }
@keyframes gc-shadow { 0%, 100% { transform: scaleX(1); opacity: .34 } 50% { transform: scaleX(.74); opacity: .16 } }
@keyframes gc-blink { 0%, 90%, 100% { transform: scaleY(1) } 93% { transform: scaleY(.08) } }
@keyframes gc-wiggle { 0%, 100% { transform: rotate(0) } 20% { transform: rotate(-8deg) } 60% { transform: rotate(7deg) } 85% { transform: rotate(-3deg) } }
@keyframes gc-hem { 0%, 100% { transform: skewX(0) } 50% { transform: skewX(-4deg) } }
.gc-float { animation: gc-float 3.4s ease-in-out infinite }
.gc-shadow { animation: gc-shadow 3.4s ease-in-out infinite; transform-origin: center }
.gc-blink { animation: gc-blink 4.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center }
.gc-hem { animation: gc-hem 1.7s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0 }
.gc-host:hover .gc-wiggle { animation: gc-wiggle .7s ease-in-out }
@media (prefers-reduced-motion: reduce) {
  .gc-float, .gc-shadow, .gc-blink, .gc-hem, .gc-host:hover .gc-wiggle { animation: none }
}
`

/**
 * Render the flat GhostCode mark (body in currentColor, eyes cut out) for
 * small chrome such as the sidebar, where shading would turn to mush.
 * @param props - size in pixels and an optional host class.
 * @returns the ghost svg.
 */
export function GhostMark({ size, className }: { size: number, className?: string | undefined }) {
  const mask = `gc-mark-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          {EYES.map(eye => <ellipse key={eye.cx} cx={eye.cx} cy={eye.cy} rx="1.6" ry="2" fill="#000" />)}
          <path d="M10.9 13.6q1.1 1 2.2 0" stroke="#000" strokeWidth="0.85" strokeLinecap="round" />
        </mask>
      </defs>
      <path d={GHOST_PATH} fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

/** Shaded, colored ghost drawing; `look` moves the face toward the pointer. */
function GhostFigure({ size, look }: { size: number, look: { x: number, y: number } }) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.65" stopColor="#f1effa" />
          <stop offset="1" stopColor="#d9d4f0" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0.36" cy="0.22" r="0.55">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-shade`} cx="0.72" cy="0.78" r="0.6">
          <stop offset="0" stopColor="#7d6fc0" stopOpacity="0.28" />
          <stop offset="1" stopColor="#7d6fc0" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}><path d={GHOST_PATH} /></clipPath>
      </defs>
      <g className="gc-hem">
        <path d={GHOST_PATH} fill={`url(#${id}-body)`} stroke="rgba(70, 58, 130, 0.22)" strokeWidth="0.35" />
      </g>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="24" height="24" fill={`url(#${id}-shade)`} />
        <ellipse cx="9.2" cy="6.4" rx="3.6" ry="2.4" fill={`url(#${id}-shine)`} />
      </g>
      <g transform={`translate(${look.x} ${look.y})`}>
        <g className="gc-blink">
          {EYES.map(eye => (
            <g key={eye.cx}>
              <ellipse cx={eye.cx} cy={eye.cy} rx="1.55" ry="1.95" fill="#2b2547" />
              <circle cx={eye.cx - 0.5 + look.x * 0.25} cy={eye.cy - 0.75 + look.y * 0.25} r="0.5" fill="#ffffff" />
              <circle cx={eye.cx + 0.55} cy={eye.cy + 0.6} r="0.22" fill="#ffffff" opacity="0.8" />
            </g>
          ))}
        </g>
        <ellipse cx="7.1" cy="13.3" rx="1.15" ry="0.62" fill="#ff9ebb" opacity="0.75" />
        <ellipse cx="16.9" cy="13.3" rx="1.15" ry="0.62" fill="#ff9ebb" opacity="0.75" />
        <path d="M10.85 13.45q1.15 1.05 2.3 0" stroke="#2b2547" strokeWidth="0.7" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/**
 * The start-screen ghost: it tilts in 3D and looks toward the pointer, floats
 * over a soft shadow, blinks, wiggles on hover, and squishes when pressed.
 * It lives only in the blank-session hero, so following stops once a chat
 * starts. Reduced-motion users get a still, front-facing ghost.
 * @param props - rendered size in pixels and an optional host class.
 * @returns the interactive ghost.
 */
export function InteractiveGhost({ size, className }: { size: number, className?: string | undefined }) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const [pose, setPose] = useState({ look: { x: 0, y: 0.1 }, tiltX: 0, tiltY: 0 })
  const [squish, setSquish] = useState(false)
  const [still] = useState(() => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)

  useEffect(() => {
    if (still) return
    let frame = 0
    let last: PointerEvent | undefined
    const update = (): void => {
      frame = 0
      const host = hostRef.current
      if (host === null || last === undefined) return
      const rect = host.getBoundingClientRect()
      const dx = last.clientX - (rect.left + rect.width / 2)
      const dy = last.clientY - (rect.top + rect.height / 2)
      const distance = Math.hypot(dx, dy)
      const reach = Math.min(1, distance / 180)
      const unit = distance === 0 ? { x: 0, y: 0 } : { x: dx / distance, y: dy / distance }
      setPose({
        look: { x: unit.x * LOOK_TRAVEL * reach, y: unit.y * LOOK_TRAVEL * reach },
        tiltY: unit.x * MAX_TILT * reach,
        tiltX: -unit.y * MAX_TILT * reach,
      })
    }
    const onMove = (event: PointerEvent): void => {
      last = event
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [still])

  useEffect(() => {
    if (!squish) return
    const timer = setTimeout(() => { setSquish(false) }, 170)
    return () => { clearTimeout(timer) }
  }, [squish])

  const tilt = `rotateX(${pose.tiltX.toFixed(2)}deg) rotateY(${pose.tiltY.toFixed(2)}deg)`
  return (
    <span
      ref={hostRef}
      className={`gc-host${className === undefined ? '' : ` ${className}`}`}
      onPointerDown={() => { if (!still) setSquish(true) }}
      style={{
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
        width: size, perspective: size * 6, cursor: 'pointer', userSelect: 'none',
      }}
    >
      <style>{HERO_KEYFRAMES}</style>
      <span className="gc-float" style={{ display: 'block' }}>
        <span className="gc-wiggle" style={{ display: 'block', transformOrigin: '50% 90%' }}>
          <span
            style={{
              display: 'block',
              transformStyle: 'preserve-3d',
              transition: squish ? 'transform 90ms ease-out' : 'transform 260ms cubic-bezier(.3,1.5,.5,1)',
              transform: squish ? `${tilt} scale(1.12, 0.86)` : tilt,
              transformOrigin: '50% 90%',
              filter: 'drop-shadow(0 6px 10px rgba(60, 45, 130, 0.22))',
            }}
          >
            <GhostFigure size={size} look={pose.look} />
          </span>
        </span>
      </span>
      <span
        className="gc-shadow"
        aria-hidden="true"
        style={{
          display: 'block', width: size * 0.56, height: Math.max(3, size * 0.08), marginTop: size * 0.02,
          borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(20, 16, 40, 0.55), transparent)',
        }}
      />
    </span>
  )
}

/**
 * Sidebar brand mark occupant.
 * @param props - host-requested size.
 * @returns the flat ghost mark.
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
 * Blank-session hero mark occupant, drawn larger than the requested size.
 * @param props - host-requested size and class.
 * @returns the interactive 3D ghost.
 */
export function GhostHeroMark({ size }: HeroBrandMarkOwnerProps) {
  // The host's class carries the old mark's hover swim, which would fight this
  // ghost's own tilt and wiggle, so the hero ghost does not take it.
  return <InteractiveGhost size={Math.round(size * HERO_SCALE)} />
}
