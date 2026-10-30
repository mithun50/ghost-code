/** Local tab: probe keyless model runtimes on this machine and offer the running ones. */

import { useEffect, useState } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconDownloadOutlineRegular, IconRefreshOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { LOCAL_RUNTIMES, monogram, type LocalRuntime } from './providers.ts'
import type { SavedModel, SavedRoute, SetupOperations } from './setup-operations.ts'
import type { FormTarget, SetupTranslate } from './ProviderForm.tsx'
import css from './ModelSetup.module.css'

type Probe = { kind: 'checking' } | { kind: 'running', models: readonly SavedModel[] } | { kind: 'off' }

/** Props of {@link LocalRuntimes}. */
export interface LocalRuntimesProps {
  t: SetupTranslate
  operations: SetupOperations
  routes: readonly SavedRoute[]
  onPick: (target: FormTarget) => void
}

/**
 * Render the Local tab.
 * @param props - see {@link LocalRuntimesProps}.
 * @returns one row per probed runtime.
 */
export function LocalRuntimes({ t, operations, routes, onPick }: LocalRuntimesProps) {
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
