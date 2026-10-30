/** Local tab: built-in models GhostCode installs and runs, plus external runtimes it can connect to. */

import { useEffect, useRef, useState } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconDownloadOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DownloadProgress, LocalModelView, LocalStatusView } from '@deepseek-ai/dsh-local-models/types'
import { LOCAL_RUNTIMES, monogram, type LocalRuntime } from './providers.ts'
import { LOCAL_ROUTE, type LocalModelOperations, type SavedModel, type SavedRoute, type SetupOperations } from './setup-operations.ts'
import type { FormTarget, SetupTranslate } from './ProviderForm.tsx'
import css from './ModelSetup.module.css'

type Probe = { kind: 'checking' } | { kind: 'running', models: readonly SavedModel[] } | { kind: 'off' }

/** Props of {@link LocalRuntimes}. */
export interface LocalRuntimesProps {
  t: SetupTranslate
  operations: SetupOperations
  routes: readonly SavedRoute[]
  onPick: (target: FormTarget) => void
  /** A built-in model is running and saved; the caller selects it. */
  onReady?: (route: string, model: string) => void
}

const POLL_MS = 1000
const GB = 1024 ** 3

function gigabytes(bytes: number): string {
  const value = bytes / GB
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1_048_576))
}

function percent(progress: DownloadProgress): number {
  return progress.total === 0 ? 0 : Math.floor((progress.done / progress.total) * 100)
}

/** Whether anything is downloading or starting, so the tab should keep polling. */
function busy(status: LocalStatusView): boolean {
  return status.runtime.state === 'downloading'
    || status.server.state === 'starting'
    || status.models.some(model => model.progress !== undefined)
}

/** A determinate bar with a byte count, or a moving bar when the size is unknown. */
function Progress({ t, label, progress }: { t: SetupTranslate, label: string, progress?: DownloadProgress | undefined }) {
  return (
    <div className={css.progress} role="status" aria-live="polite">
      <span className={css.progressLabel}>{label}</span>
      <div
        className={css.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...progress === undefined ? {} : { 'aria-valuenow': percent(progress) }}
      >
        {progress === undefined
          ? <div className={css.indeterminate} />
          : <div className={css.fill} style={{ width: `${String(percent(progress))}%` }} />}
      </div>
      {progress !== undefined && (
        <span className={css.progressBytes}>
          {t('local.bytes', { done: megabytes(progress.done), total: megabytes(progress.total), percent: String(percent(progress)) })}
        </span>
      )}
    </div>
  )
}

/** Built-in models: the scan, the catalog and the one server. */
function BuiltInModels({ t, local, onReady }: { t: SetupTranslate, local: LocalModelOperations, onReady?: ((route: string, model: string) => void) | undefined }) {
  const [status, setStatus] = useState<LocalStatusView | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [want, setWant] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const saving = useRef<string | null>(null)

  const accept = (next: LocalStatusView): void => { setStatus(next); setError(null) }
  const fail = (failure: unknown): void => { setError(failure instanceof Error ? failure.message : String(failure)) }

  useEffect(() => {
    let live = true
    local.status().then((next) => { if (live) accept(next) }, (failure: unknown) => { if (live) fail(failure) })
    return () => { live = false }
  }, [local, round])

  const polling = status !== undefined && (busy(status) || want !== null)
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => { local.status().then(accept, fail) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [polling, local])

  // Once the wanted model serves, save the route and hand the model to the composer.
  useEffect(() => {
    if (status === undefined || want === null) return
    const row = status.models.find(model => model.id === want)
    if (row?.error !== undefined) { setWant(null); return }
    const { server } = status
    if (server.model === want && server.state === 'error') { setWant(null); return }
    if (server.model !== want || server.state !== 'running' || server.baseURL === undefined) return
    if (server.phase !== undefined || saving.current === want) return
    saving.current = want
    const installed = status.models.filter(model => model.installed)
    local.saveRoute(server.baseURL, installed).then(
      () => { setWant(null); onReady?.(LOCAL_ROUTE, want) },
      fail,
    ).finally(() => { saving.current = null })
  }, [status, want, local, onReady])

  const act = (call: Promise<LocalStatusView>): void => { call.then(accept, fail) }
  const install = (id: string): void => { setWant(id); act(local.install(id)) }
  const use = (id: string): void => { setWant(id); act(local.start(id)) }

  if (status === undefined) {
    return error === null
      ? <p className={css.status}><StateDot state="ongoing" />{t('local.scanning')}</p>
      : <p className={css.error}>{error}</p>
  }

  const { system, runtime, server } = status
  const serving = server.model === undefined ? undefined : status.models.find(model => model.id === server.model)
  return (
    <div className={css.stack} data-local-builtin>
      <div className={css.systemCard} data-local-system>
        <span className={css.cardName}>{t('local.system', { cpu: system.cpu, threads: String(system.threads) })}</span>
        <span className={css.cardBody}>
          {t('local.ram', { free: gigabytes(system.freeRam), total: gigabytes(system.totalRam) })}
          {' · '}
          {system.gpus.length > 0 ? system.gpus.join(', ') : t('local.noGpu')}
          {system.freeDisk === undefined ? null : <>{' · '}{t('local.disk', { free: gigabytes(system.freeDisk) })}</>}
        </span>
        <Button size="sm" icon={<IconRefreshOutlineRegular />} onClick={() => { setRound(round + 1) }}>{t('local.refresh')}</Button>
      </div>

      {runtime.state === 'downloading' && (
        <Progress t={t} label={t('local.runtime', { backend: runtime.backend })} progress={runtime.progress} />
      )}
      {runtime.state === 'error' && runtime.error !== undefined && <p className={css.error}>{runtime.error}</p>}
      {server.state === 'starting' && serving !== undefined && (
        <Progress t={t} label={server.phase ?? t('local.starting', { name: serving.name })} />
      )}
      {server.state === 'running' && serving !== undefined && (
        <div className={css.serverRow} data-local-server="running">
          <span className={`${css.status} ${css.statusOn}`}>
            <IconCheckCircleFillRegular size={14} />
            {server.phase !== undefined
              ? server.phase
              : serving.measuredTps === undefined
                ? t('local.runningModel', { name: serving.name })
                : t('local.runningSpeed', { name: serving.name, tps: String(serving.measuredTps) })}
          </span>
          <Button size="sm" onClick={() => { act(local.stop()) }}>{t('local.stop')}</Button>
        </div>
      )}
      {server.state === 'error' && server.error !== undefined && (
        <p className={css.error}>{t('local.serverError', { message: server.error })}</p>
      )}
      {error !== null && <p className={css.error}>{error}</p>}

      <div className={css.list}>
        {status.models.map((model: LocalModelView) => {
          const running = server.state === 'running' && server.model === model.id
          const tps = model.measuredTps === undefined
            ? t('local.speedEstimated', { tps: String(model.estimatedTps) })
            : t('local.speedMeasured', { tps: String(model.measuredTps) })
          return (
            <div className={css.modelCard} key={model.id} data-local-model={model.id} data-recommended={model.recommended || undefined}>
              <div className={css.modelHead}>
                <span className={css.cardName}>{model.name}</span>
                <span className={css.badge}>{model.bits}</span>
                {model.recommended && <span className={`${css.badge} ${css.badgeAccent}`}>{t('local.recommended')}</span>}
                {model.installed && !running && <span className={css.badge}>{t('local.installed')}</span>}
                <span className={css.rowActions}>
                  {model.progress !== undefined
                    ? <StateDot state="ongoing" />
                    : model.installed
                      ? (
                        <>
                          {!running && (
                            <Button variant="primary" size="sm" disabled={want !== null} onClick={() => { use(model.id) }}>{t('local.use')}</Button>
                          )}
                          <button type="button" className={css.iconButton} aria-label={t('local.removeModel', { name: model.name })}
                            title={t('local.removeModel', { name: model.name })} onClick={() => { act(local.remove(model.id)) }}>
                            <IconTrashOutlineRegular />
                          </button>
                        </>
                      )
                      : (
                        <Button {...model.recommended ? { variant: 'primary' as const } : {}} size="sm" icon={<IconDownloadOutlineRegular />}
                          disabled={model.fit === 'too-big' || want !== null} onClick={() => { install(model.id) }}>
                          {t('local.install')}
                        </Button>
                      )}
                </span>
              </div>
              <span className={css.cardBody}>
                {t('local.meta', { params: model.params, active: model.activeParams, size: gigabytes(model.size), ram: gigabytes(model.ramNeed) })}
                {' · '}
                {tps}
              </span>
              <span className={css.hint}>{model.notes}</span>
              {model.fit === 'tight' && !model.installed && <span className={css.warn}>{t('local.fitTight')}</span>}
              {model.fit === 'too-big' && <span className={css.warn}>{t('local.fitTooBig', { ram: gigabytes(model.ramNeed) })}</span>}
              {model.progress !== undefined && (
                <Progress t={t} label={t('local.downloading', { name: model.name })} progress={model.progress} />
              )}
              {model.error !== undefined && <span className={css.error}>{model.error}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Render the Local tab.
 * @param props - see {@link LocalRuntimesProps}.
 * @returns the built-in models and one row per probed external runtime.
 */
export function LocalRuntimes({ t, operations, routes, onPick, onReady }: LocalRuntimesProps) {
  const [probes, setProbes] = useState<Readonly<Record<string, Probe>>>({})
  const [round, setRound] = useState(0)

  useEffect(() => {
    let live = true
    setProbes(Object.fromEntries(LOCAL_RUNTIMES.map(runtime => [runtime.route, { kind: 'checking' } as Probe])))
    for (const runtime of LOCAL_RUNTIMES) {
      operations.discover({ baseURL: runtime.baseURL, api: 'openai-completions' }).then(
        (models) => {
          if (live) setProbes(current => ({ ...current, [runtime.route]: { kind: 'running', models: models.map(model => ({ id: model.id })) } }))
        },
        () => { if (live) setProbes(current => ({ ...current, [runtime.route]: { kind: 'off' } })) },
      )
    }
    return () => { live = false }
  }, [operations, round])

  const pick = (runtime: LocalRuntime, models: readonly SavedModel[]): void => {
    const existing = routes.find(route => route.route === runtime.route)
    onPick({
      route: runtime.route,
      name: runtime.name,
      api: 'openai-completions',
      baseURL: runtime.baseURL,
      keyless: true,
      initialModels: models,
      ...existing === undefined ? {} : { existing },
    })
  }

  return (
    <div className={css.stack}>
      {operations.local !== undefined && (
        <>
          <h3 className={css.sectionTitle}>{t('local.builtin')}</h3>
          <p className={css.hint}>{t('local.builtinIntro')}</p>
          <BuiltInModels t={t} local={operations.local} onReady={onReady} />
        </>
      )}
      <h3 className={css.sectionTitle}>{t('local.external')}</h3>
      <div className={css.actions}>
        <p className={css.hint}>{t('local.intro')}</p>
        <Button size="sm" icon={<IconRefreshOutlineRegular />} onClick={() => { setRound(round + 1) }}>{t('local.refresh')}</Button>
      </div>
      <div className={css.list}>
        {LOCAL_RUNTIMES.map((runtime) => {
          const probe = probes[runtime.route] ?? { kind: 'checking' }
          const added = routes.some(route => route.route === runtime.route)
          return (
            <div className={css.row} key={runtime.route} data-local-runtime={runtime.route}>
              <span className={css.monogram} aria-hidden>{monogram(runtime.name)}</span>
              <span className={css.cardCopy}>
                <span className={css.cardName}>{runtime.name}</span>
                <span className={css.cardBody}>{runtime.baseURL}</span>
              </span>
              {probe.kind === 'checking' && <span className={css.status}><StateDot state="ongoing" />{t('local.checking')}</span>}
              {probe.kind === 'running' && (
                <>
                  <span className={`${css.status} ${css.statusOn}`}><IconCheckCircleFillRegular size={14} />{t('local.running')}</span>
                  <Button variant="primary" size="sm" onClick={() => { pick(runtime, probe.models) }}>
                    {added ? t('byok.edit', { name: runtime.name }) : t('byok.add')}
                  </Button>
                </>
              )}
              {probe.kind === 'off' && (
                <>
                  <span className={css.status}>{t('local.notRunning')}</span>
                  <a className={css.link} href={runtime.downloadUrl} target="_blank" rel="noreferrer">
                    <IconDownloadOutlineRegular size={12} /> {t('local.download', { name: runtime.name })}
                  </a>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
