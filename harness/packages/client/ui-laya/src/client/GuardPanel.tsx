/** Composer privacy shield: where requests go, what was kept on the machine, the escalation evidence, and Laya's decisions. */

import { useEffect, useRef, useState } from 'react'
import type { EgressEntry, GuardView } from '@deepseek-ai/dsh-local-models/types'
import type { LayaDecision } from '@deepseek-ai/dsh-laya/types'
import type { LayaKey } from './locales.ts'
import css from './LayaToggle.module.css'

/** Host operations; a string result is the failure message. */
export interface GuardOperations {
  guard(): Promise<GuardView | string>
  egress(limit: number): Promise<EgressEntry[] | string>
  setPolicy(cloud: 'allow' | 'block', escalateTo: string): Promise<GuardView | string>
  decisions(limit: number): Promise<LayaDecision[] | string>
}

export interface GuardPanelProps {
  ops: GuardOperations
  t: (key: LayaKey, params?: Record<string, string>) => string
}

const POLL_OPEN_MS = 1500
const POLL_IDLE_MS = 4000

function kb(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** One egress log line in plain words. */
function describe(entry: EgressEntry, t: GuardPanelProps['t']): string {
  switch (entry.kind) {
    case 'cloud-request':
      return t('guard.log.cloud', {
        target: `${entry.provider ?? ''}/${entry.model ?? ''}`,
        size: kb(entry.bytes ?? 0),
        secrets: String(entry.secretsRemoved ?? 0),
        files: String(entry.withheld?.length ?? 0),
      })
    case 'blocked-request': return t('guard.log.blockedRequest')
    case 'blocked-read': return t('guard.log.blockedRead', { file: entry.files?.[0] ?? '' })
    default: return entry.detail ?? entry.kind
  }
}

/**
 * Render the shield button and its panel.
 * @param props - Host operations and the `laya` translate seat.
 * @returns the button element tree.
 */
export function GuardPanel({ ops, t }: GuardPanelProps) {
  const [view, setView] = useState<GuardView | undefined>(undefined)
  const [log, setLog] = useState<EgressEntry[]>([])
  const [decisions, setDecisions] = useState<LayaDecision[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      const next = await ops.guard()
      if (!alive.current) return
      if (typeof next === 'string') setError(next)
      else { setView(next); setError(undefined) }
      if (open) {
        const [rows, made] = await Promise.all([ops.egress(12), ops.decisions(6)])
        if (!alive.current) return
        if (typeof rows !== 'string') setLog(rows)
        if (typeof made !== 'string') setDecisions(made)
      }
      timer = setTimeout(() => { void tick() }, open ? POLL_OPEN_MS : POLL_IDLE_MS)
    }
    void tick()
    return () => { alive.current = false; if (timer !== undefined) clearTimeout(timer) }
  }, [ops, open])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || wrapRef.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])

  if (view === undefined) return error === undefined ? null : <span className={css.wrap} title={error} />
  const totals = view.totals
  const local = view.route === 'local'
  const kept = totals.secretsRemoved + totals.filesWithheld + totals.blockedReads
  const offline = view.network === 'offline'
  const label = offline ? t('guard.label.offline') : view.cloudPolicy === 'block' ? t('guard.label.private') : local ? t('guard.label.local') : t('guard.label.cloud')
  const layaOn = view.laya === 'on'
  const lastLaya = decisions.at(-1)

  return (
    <span ref={wrapRef} className={css.wrap} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
      <button
        type="button"
        className={css.button}
        data-state={view.cloudPolicy === 'block' || local ? 'on' : 'cloud'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('guard.aria', { label })}
        title={t('guard.tip')}
        onClick={() => { setOpen(value => !value) }}
        data-guard-badge={view.route}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V5.6L12 2.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          {local || view.cloudPolicy === 'block'
            ? <path d="m8.6 12.2 2.4 2.4 4.4-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M12 8v4.6M12 15.6v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
        <span>{label}</span>
        {kept > 0 && <span className={css.count}>{String(kept)}</span>}
        {layaOn && <span className={css.layaDot} title={t('guard.layaActive')} aria-hidden="true" />}
      </button>
      {open && (
        <div className={`${css.popover} ${css.guardPopover}`} role="dialog" aria-label={t('guard.title')}>
          <p className={css.title}>{t('guard.title')}</p>
          <p className={css.body}>{t('guard.subtitle')}</p>

          <div className={css.section} data-guard-section="route">
            <p className={css.sectionTitle}>{t('guard.route')}</p>
            <p className={css.line}>
              <span className={local ? css.pillOk : css.pillWarn}>{local ? t('guard.onDevice') : t('guard.inCloud')}</span>
              {' '}
              <code>{view.provider === undefined ? '-' : `${view.provider}/${view.model ?? ''}`}</code>
            </p>
            <p className={css.hint}>{t('guard.freeRam', { gb: (view.freeRam / 1024 ** 3).toFixed(1) })}</p>
            {offline && <p className={css.line}>{t('guard.offline')}</p>}
          </div>

          <div className={css.section} data-guard-section="leak">
            <p className={css.sectionTitle}>{t('guard.hint1')}</p>
            <p className={css.line}>{t('guard.kept', {
              secrets: String(totals.secretsRemoved),
              files: String(totals.filesWithheld),
              reads: String(totals.blockedReads),
            })}</p>
            <p className={css.hint}>{t('guard.sent', { count: String(totals.cloudRequests), size: kb(totals.bytesSent) })}</p>
            <label className={css.toggle}>
              <input
                type="checkbox"
                checked={view.cloudPolicy === 'block'}
                onChange={(event) => {
                  void ops.setPolicy(event.target.checked ? 'block' : 'allow', view.escalateTo).then((next) => {
                    if (typeof next !== 'string') setView(next)
                  })
                }}
              />
              {t('guard.privacyMode')}
            </label>
          </div>

          <div className={css.section} data-guard-section="evidence">
            <p className={css.sectionTitle}>{t('guard.hint2')}</p>
            <p className={css.line}>{t('guard.evidence', {
              passed: String(totals.passed),
              failed: String(totals.failed),
              streak: String(totals.streak),
              limit: String(view.escalateAfter),
            })}</p>
            <p className={css.hint}>{totals.escalated ? t('guard.escalated') : t('guard.notEscalated')}</p>
            {view.checks.length > 0 && (
              <ul className={css.list}>
                {view.checks.slice(-4).map(check => (
                  <li key={`${String(check.time)}-${check.reason}`}>
                    <span className={check.passed ? css.pillOk : css.pillWarn}>{check.passed ? t('guard.pass') : t('guard.fail')}</span>
                    {' '}{check.tool}: {check.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={css.section} data-guard-section="resources">
            <p className={css.sectionTitle}>{t('guard.hint3')}</p>
            <p className={css.line}>{t('guard.recoveries', { count: String(totals.recoveries) })}</p>
          </div>

          <div className={css.section} data-guard-section="laya">
            <p className={css.sectionTitle}>{t('guard.laya')}</p>
            <p className={css.line}>
              <span className={layaOn ? css.pillOk : css.pillIdle}>{layaOn ? t('guard.layaOn') : t('guard.layaOff')}</span>
              {lastLaya !== undefined && <> {t('guard.layaLast', {
                question: lastLaya.question,
                answer: lastLaya.probability === undefined ? '-' : `${String(Math.round(lastLaya.probability * 100))}%`,
                action: lastLaya.action,
                ms: String(lastLaya.latencyMs),
              })}</>}
            </p>
          </div>

          {log.length > 0 && (
            <div className={css.section} data-guard-section="log">
              <p className={css.sectionTitle}>{t('guard.log')}</p>
              <ul className={css.list}>
                {log.slice(-6).reverse().map(entry => (
                  <li key={`${String(entry.time)}-${entry.kind}`}><span className={css.time}>{clock(entry.time)}</span> {describe(entry, t)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
