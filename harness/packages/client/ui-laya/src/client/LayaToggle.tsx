/** Composer brain button over the Host `laya` Remote: install, then toggle decisions. */

import { useEffect, useRef, useState } from 'react'
import { Button, IconThinkOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LayaKey } from './locales.ts'
import css from './LayaToggle.module.css'

/** Structural view of the Host status; matches `LayaStatusView`. */
export interface LayaView {
  readonly state: 'not-installed' | 'installing' | 'off' | 'starting' | 'on' | 'error'
  readonly phase?: string
  readonly progress?: { readonly done: number, readonly total: number }
  readonly error?: string
}

/** Megabytes with one decimal under 10 MB, whole numbers above. */
function megabytes(bytes: number): string {
  const mb = bytes / 1_048_576
  return mb < 10 ? mb.toFixed(1) : String(Math.round(mb))
}

/** One recorded decision; matches `LayaDecision`. */
export interface LayaDecisionView {
  readonly time: number
  readonly hook: string
  readonly question: string
  readonly probability?: number
  readonly latencyMs: number
  readonly action: string
}

/** Host operations; a string result is the failure message. */
export interface LayaOperations {
  /** Recent decisions, newest last; absent hides the decision chip. */
  decisions?(limit: number): Promise<LayaDecisionView[] | string>
  status(): Promise<LayaView | string>
  install(): Promise<LayaView | string>
  enable(): Promise<LayaView | string>
  disable(): Promise<LayaView | string>
}

export interface LayaToggleProps {
  ops: LayaOperations
  t: (key: LayaKey, params?: Record<string, string>) => string
}

const POLL_MS = 1500
const DECISION_POLL_MS = 2000
const FRESH_MS = 5000

/**
 * Render the brain button and, when Laya is missing or failed, its popover.
 * @param props - Host operations and the `laya` translate seat.
 * @returns the button element tree.
 */
export function LayaToggle({ ops, t }: LayaToggleProps) {
  const [view, setView] = useState<LayaView | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const accept = (result: LayaView | string): void => {
    if (!alive.current) return
    if (typeof result === 'string') { setFailure(result); return }
    setView(result)
    setFailure(undefined)
  }

  useEffect(() => {
    alive.current = true
    void ops.status().then(accept)
    return () => { alive.current = false }
  }, [ops])

  const state = view?.state
  const polling = state === 'installing' || state === 'starting'
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => { void ops.status().then(accept) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [polling, ops])

  // While Laya is on, show what it decided for the latest prompt.
  const [decision, setDecision] = useState<LayaDecisionView | undefined>(undefined)
  const [fresh, setFresh] = useState(false)
  const seen = useRef(0)
  const isOn = view?.state === 'on'
  useEffect(() => {
    if (!isOn || ops.decisions === undefined) return
    let freshTimer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      void ops.decisions?.(1).then((rows) => {
        if (!alive.current || typeof rows === 'string') return
        const last = rows.at(-1)
        if (last === undefined) return
        setDecision(last)
        if (seen.current !== 0 && last.time !== seen.current) {
          setFresh(true)
          if (freshTimer !== undefined) clearTimeout(freshTimer)
          freshTimer = setTimeout(() => { if (alive.current) setFresh(false) }, FRESH_MS)
        }
        seen.current = last.time
      })
    }
    tick()
    const timer = setInterval(tick, DECISION_POLL_MS)
    return () => { clearInterval(timer); if (freshTimer !== undefined) clearTimeout(freshTimer) }
  }, [isOn, ops])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || wrapRef.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])

  const run = (action: () => Promise<LayaView | string>): void => {
    setBusy(true)
    void action()
      .then(accept, (error: unknown) => { accept(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (alive.current) setBusy(false) })
  }

  const message = failure ?? (state === 'error' ? view?.error : undefined)
  const errored = message !== undefined
  const waiting = view === undefined && !errored
  const working = busy || polling || waiting
  const needsPopover = state === 'not-installed' || errored
  const shown = errored ? 'error' : state ?? 'off'

  const aria = errored
    ? t('tooltip.error', { message: message ?? '' })
    : working ? t('button.aria.busy')
      : state === 'not-installed' ? t('button.aria.notInstalled')
        : state === 'on' ? t('button.aria.on') : t('button.aria.off')
  const tip = errored
    ? t('tooltip.error', { message: message ?? '' })
    : state === 'installing'
      ? (view?.phase === undefined ? t('tooltip.installing') : `${t('tooltip.installing')}: ${view.phase}`)
      : state === 'starting' ? t('tooltip.starting')
        : state === 'not-installed' ? t('popover.title')
          : state === 'on' ? t('tooltip.on') : t('tooltip.off')

  const onClick = (): void => {
    if (needsPopover) { setOpen(value => !value); return }
    if (state === 'off') run(() => ops.enable())
    else if (state === 'on') run(() => ops.disable())
  }

  return (
    <span ref={wrapRef} className={css.wrap} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <button
        type="button"
        className={css.button}
        data-state={shown}
        aria-label={aria}
        title={tip}
        aria-haspopup={needsPopover ? 'dialog' : undefined}
        aria-expanded={needsPopover ? open : undefined}
        disabled={working && !errored}
        onClick={onClick}
      >
        {working && !errored ? <StateDot state="ongoing" /> : <IconThinkOutlineRegular size={16} />}
        {state === 'on' && !errored ? <span>{t('label.on')}</span> : null}
      </button>
      {isOn && decision !== undefined && !errored && (
        <span
          className={css.decision}
          data-fresh={fresh ? '' : undefined}
          data-action={decision.action}
          title={t('decision.title', { question: decision.question })}
          data-laya-decision
        >
          {t('decision.label', {
            verdict: t(`decision.${decision.action}` as LayaKey) || decision.action,
            percent: decision.probability === undefined ? '-' : String(Math.round(decision.probability * 100)),
            ms: String(decision.latencyMs),
          })}
        </span>
      )}
      {polling && !errored && (
        <div className={css.progress} role="status" aria-live="polite">
          <p className={css.title}>{state === 'installing' ? t('tooltip.installing') : t('tooltip.starting')}</p>
          {view?.phase !== undefined && <p className={css.phase}>{view.phase}</p>}
          <div
            className={css.track}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            {...view?.progress === undefined || view.progress.total === 0
              ? {}
              : { 'aria-valuenow': Math.floor((view.progress.done / view.progress.total) * 100) }}
          >
            {view?.progress === undefined || view.progress.total === 0
              ? <div className={css.indeterminate} />
              : <div className={css.fill} style={{ width: `${String((view.progress.done / view.progress.total) * 100)}%` }} />}
          </div>
          {view?.progress !== undefined && view.progress.total > 0 && (
            <p className={css.bytes}>
              {t('progress.bytes', {
                done: megabytes(view.progress.done),
                total: megabytes(view.progress.total),
                percent: String(Math.floor((view.progress.done / view.progress.total) * 100)),
              })}
            </p>
          )}
        </div>
      )}
      {open && needsPopover && (
        <div className={css.popover} role="dialog" aria-label={t('popover.title')}>
          <p className={css.title}>{t('popover.title')}</p>
          <p className={css.body}>{t('popover.body')}</p>
          {errored ? <p className={css.error}>{message}</p> : null}
          <div className={css.actions}>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false) }}>{t('popover.cancel')}</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setOpen(false)
                // Install resumes: it skips finished steps, then starts Laya.
                run(() => ops.install())
              }}
            >
              {errored ? t('popover.retry') : t('popover.install')}
            </Button>
          </div>
        </div>
      )}
    </span>
  )
}
