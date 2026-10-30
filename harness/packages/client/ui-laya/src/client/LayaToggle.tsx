/** Composer brain button over the Host `laya` Remote: install, then toggle decisions. */

import { useEffect, useRef, useState } from 'react'
import { Button, IconThinkOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LayaKey } from './locales.ts'
import css from './LayaToggle.module.css'

/** Structural view of the Host status; matches `LayaStatusView`. */
export interface LayaView {
  readonly state: 'not-installed' | 'installing' | 'off' | 'starting' | 'on' | 'error'
  readonly phase?: string
  readonly error?: string
}

/** Host operations; a string result is the failure message. */
export interface LayaOperations {
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
                run(() => (errored ? ops.enable() : ops.install()))
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
