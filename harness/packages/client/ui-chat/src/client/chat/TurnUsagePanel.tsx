/** Completed-Turn token usage action and its accounting details dialog. */

import { createPortal } from 'react-dom'
import { IconClockOutlineRegular, IconDatabaseOutlineRegular, IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnStats, TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import css from './TurnUsagePanel.module.css'
import dialogCss from './stat-dialog.module.css'

export interface TurnUsagePanelProps {
  /** Exact token accounting; absent when the provider reported none. */
  usage?: TurnTokenUsage | undefined
  /** Provider-independent timing and call counts. */
  stats?: TurnStats | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

function formatCompactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) })
}

function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/**
 * Wall-clock span: `850 ms`, `12.4s`, `2m 05s`.
 * @param ms - non-negative milliseconds.
 * @param t - Chat locale seat.
 * @returns locale-owned duration text.
 */
export function formatSpan(ms: number, t: ChatViewSlotProps['t']): string {
  if (ms < 1_000) return t('message.turnStats.milliseconds', { value: String(Math.round(ms)) })
  if (ms < 60_000) return t('message.turnStats.seconds', { value: (ms / 1_000).toFixed(1) })
  const total = Math.round(ms / 1_000)
  return t('message.turnStats.minutes', {
    minutes: String(Math.floor(total / 60)),
    seconds: String(total % 60).padStart(2, '0'),
  })
}

/**
 * Output speed: one decimal under 100 tok/s, whole numbers above.
 * @param value - tokens per second.
 * @param t - Chat locale seat.
 * @returns locale-owned speed text.
 */
export function formatSpeed(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnStats.tps', { value: value >= 100 ? String(Math.round(value)) : value.toFixed(1) })
}

/**
 * One-line Turn summary segments, for example
 * `12.4s`, `3 calls`, `2 tools`, `1.2K in`, `340 out`, `45.0 tok/s`.
 * Unknown facts are omitted rather than estimated.
 * @param usage - exact token accounting, when reported.
 * @param stats - timing and call counts, when derived.
 * @param t - Chat locale seat.
 * @returns the summary segments in display order.
 */
export function turnSummary(
  usage: TurnTokenUsage | undefined,
  stats: TurnStats | undefined,
  t: ChatViewSlotProps['t'],
): string[] {
  const parts: string[] = []
  if (stats !== undefined) {
    parts.push(formatSpan(stats.durationMs, t))
    parts.push(stats.apiCalls === 1
      ? t('message.turnStats.callOne')
      : t('message.turnStats.callMany', { count: String(stats.apiCalls) }))
    if (stats.toolCalls > 0) {
      parts.push(stats.toolCalls === 1
        ? t('message.turnStats.toolOne')
        : t('message.turnStats.toolMany', { count: String(stats.toolCalls) }))
    }
  }
  if (usage !== undefined) {
    parts.push(t('message.turnStats.input', { count: formatTokens(usage.totalTokens - usage.outputTokens, t) }))
    parts.push(t('message.turnStats.output', { count: formatTokens(usage.outputTokens, t) }))
  }
  if (stats?.outputTokensPerSecond !== undefined) parts.push(formatSpeed(stats.outputTokensPerSecond, t))
  return parts
}

/** Separator between summary segments (a middle dot, never a dash). */
const SUMMARY_SEPARATOR = ' \u00b7 '

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * @param props - Turn usage buckets and locale seat.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage, stats, t }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()

  const cacheHit = usage?.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  const routes = usage?.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''
  // Without timing the pill keeps its token-total wording; with timing it
  // carries the whole one-line summary.
  const label = stats === undefined
    ? usage === undefined ? '' : t('message.turnUsage.consumed', { total: formatCompactCount(usage.totalTokens, t) })
    : turnSummary(usage, stats, t).join(SUMMARY_SEPARATOR)
  if (label === '') return null

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        {stats === undefined ? <IconDatabaseOutlineRegular /> : <IconClockOutlineRegular />}
        <span className={css.label} data-turn-stats={stats === undefined ? undefined : ''}>{label}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnUsage.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutlineRegular />
              {t('message.turnUsage.title')}
            </span>
            <span className={dialogCss.titleValue}>
              {usage === undefined
                ? stats === undefined ? null : formatSpan(stats.durationMs, t)
                : formatExactCount(usage.totalTokens, t)}
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-usage-details>
            {stats !== undefined && (
              <>
                <dt>{t('message.turnStats.duration')}</dt>
                <dd>{formatSpan(stats.durationMs, t)}</dd>
                {stats.modelMs !== undefined && (
                  <>
                    <dt>{t('message.turnStats.modelTime')}</dt>
                    <dd>{formatSpan(stats.modelMs, t)}</dd>
                  </>
                )}
                {stats.ttftMs !== undefined && (
                  <>
                    <dt>{t('message.turnStats.ttft')}</dt>
                    <dd>{formatSpan(stats.ttftMs, t)}</dd>
                  </>
                )}
                {stats.outputTokensPerSecond !== undefined && (
                  <>
                    <dt>{t('message.turnStats.speed')}</dt>
                    <dd><IconGaugeOutlineRegular /> {formatSpeed(stats.outputTokensPerSecond, t)}</dd>
                  </>
                )}
                <dt>{t('message.turnStats.apiCalls')}</dt>
                <dd>{String(stats.apiCalls)}</dd>
                <dt>{t('message.turnStats.toolCalls')}</dt>
                <dd>{String(stats.toolCalls)}</dd>
              </>
            )}
            {routes !== '' && (
              <>
                <dt>{t('message.turnUsage.model')}</dt>
                <dd className={dialogCss.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            {usage !== undefined && <>
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens, t)}
              {usage.reasoningTokens !== undefined && (
                <span className={dialogCss.reasoning}>
                  {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
                </span>
              )}
            </dd>
            </>}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}
