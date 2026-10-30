/** Composer model setup: BYOK providers and local runtimes in one modal. */

import { useCallback, useEffect, useState } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconEditOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  Modal, SegmentedControl,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { monogram, PROVIDER_PRESETS } from './providers.ts'
import { LOCAL_ROUTE, type SavedRoute, type SetupOperations } from './setup-operations.ts'
import { ProviderForm, type FormTarget, type SetupTranslate } from './ProviderForm.tsx'
import { LocalRuntimes } from './LocalRuntimes.tsx'
import css from './ModelSetup.module.css'

/** Which tab the modal shows. */
export type SetupTab = 'byok' | 'local'

/** Props of {@link ModelSetupModal}. */
export interface ModelSetupModalProps {
  t: SetupTranslate
  initialTab: SetupTab
  operations: SetupOperations
  onClose: () => void
  /** A route was saved; the caller may select its first model. */
  onSaved: (route: string, firstModel: string) => void
  /** A built-in local model is running and saved; the caller selects it. */
  onLocalReady?: (route: string, model: string) => void
}

const LOCAL_ROUTES = new Set(['ollama', 'lmstudio', LOCAL_ROUTE])

/**
 * Render the setup modal.
 * @param props - see {@link ModelSetupModalProps}.
 * @returns the portaled modal.
 */
export function ModelSetupModal({ t, initialTab, operations, onClose, onSaved, onLocalReady }: ModelSetupModalProps) {
  const [tab, setTab] = useState<SetupTab>(initialTab)
  const [routes, setRoutes] = useState<readonly SavedRoute[]>([])
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<FormTarget | null>(null)
  const [removing, setRemoving] = useState<SavedRoute | null>(null)

  const refresh = useCallback(() => {
    operations.listRoutes().then(
      (next) => { setRoutes(next); setError(null) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }, [operations])
  useEffect(() => { refresh() }, [refresh])

  const cloudRoutes = routes.filter(route => !LOCAL_ROUTES.has(route.route))
  const editRoute = (route: SavedRoute): void => {
    const preset = PROVIDER_PRESETS.find(candidate => candidate.route === route.route)
    setTarget({
      route: route.route,
      name: route.displayName,
      api: route.api ?? preset?.api ?? 'openai-completions',
      baseURL: route.baseURL ?? preset?.baseURL ?? '',
      ...preset === undefined ? {} : { keyUrl: preset.keyUrl },
      ...LOCAL_ROUTES.has(route.route) ? { keyless: true } : {},
      existing: route,
    })
  }

  const confirmRemove = async (route: SavedRoute): Promise<void> => {
    try {
      await operations.removeRoute(route.route, route.apiKeyEnv)
      setRemoving(null)
      refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const body = target !== null
    ? (
      <ProviderForm
        key={target.route ?? 'custom'}
        t={t}
        target={target}
        taken={routes.map(route => route.route)}
        operations={operations}
        onBack={() => { setTarget(null) }}
        onSaved={(route, first) => { setTarget(null); refresh(); onSaved(route, first) }}
      />
    )
    : tab === 'local'
      ? (
        <LocalRuntimes
          t={t}
          operations={operations}
          routes={routes}
          onPick={setTarget}
          onReady={(route, model) => { refresh(); onLocalReady?.(route, model) }}
        />
      )
      : (
        <div className={css.stack}>
          <h3 className={css.sectionTitle}>{t('byok.yours')}</h3>
          {cloudRoutes.length === 0
            ? <p className={css.hint}>{t('byok.empty')}</p>
            : (
              <div className={css.list}>
                {cloudRoutes.map(route => (
                  <div className={css.row} key={route.route} data-provider-row={route.route}>
                    <span className={css.monogram} aria-hidden>{monogram(route.displayName)}</span>
                    <span className={css.cardCopy}>
                      <span className={css.cardName}>{route.displayName}</span>
                      <span className={css.cardBody}>{t('byok.models', { count: route.models.length })}</span>
                    </span>
                    {removing?.route === route.route
                      ? (
                        <span className={css.rowActions}>
                          <span className={css.hint}>{t('byok.removeConfirm', { name: route.displayName })}</span>
                          <Button size="sm" onClick={() => { setRemoving(null) }}>{t('form.cancel')}</Button>
                          <Button variant="primary" size="sm" onClick={() => { void confirmRemove(route) }}>{t('byok.removeYes')}</Button>
                        </span>
                      )
                      : (
                        <span className={css.rowActions}>
                          <button type="button" className={css.iconButton} aria-label={t('byok.edit', { name: route.displayName })}
                            title={t('byok.edit', { name: route.displayName })} onClick={() => { editRoute(route) }}>
                            <IconEditOutlineRegular />
                          </button>
                          <button type="button" className={css.iconButton} aria-label={t('byok.remove', { name: route.displayName })}
                            title={t('byok.remove', { name: route.displayName })} onClick={() => { setRemoving(route) }}>
                            <IconTrashOutlineRegular />
                          </button>
                        </span>
                      )}
                  </div>
                ))}
              </div>
            )}
          <h3 className={css.sectionTitle}>{t('byok.add')}</h3>
          <div className={css.grid}>
            {PROVIDER_PRESETS.map((preset) => {
              const saved = routes.find(route => route.route === preset.route)
              return (
                <button type="button" key={preset.route} className={css.card} data-provider={preset.route}
                  aria-label={preset.name}
                  onClick={() => {
                    if (saved !== undefined) editRoute(saved)
                    else setTarget({ route: preset.route, name: preset.name, api: preset.api, baseURL: preset.baseURL, keyUrl: preset.keyUrl })
                  }}>
                  <span className={css.monogram} aria-hidden>{monogram(preset.name)}</span>
                  <span className={css.cardCopy}><span className={css.cardName}>{preset.name}</span></span>
                  {saved !== undefined && (
                    <span className={css.cardIcon} title={t('byok.added')}><IconCheckCircleFillRegular size={16} /></span>
                  )}
                </button>
              )
            })}
            <button type="button" className={css.card} data-provider="custom" aria-label={t('byok.custom')}
              onClick={() => { setTarget({ name: '', api: 'openai-completions', baseURL: '' }) }}>
              <span className={css.monogram} aria-hidden><IconPlusOutlineRegular size={14} /></span>
              <span className={css.cardCopy}>
                <span className={css.cardName}>{t('byok.custom')}</span>
                <span className={css.cardBody}>{t('byok.customBody')}</span>
              </span>
            </button>
          </div>
        </div>
      )

  return (
    <Modal open onClose={onClose} title={t('setup.title')} closeLabel={t('setup.close')}
      className={css.dialog as string} contentClassName={css.content as string}>
      <div className={css.stack}>
        {target === null && (
          <SegmentedControl<SetupTab>
            id="ghostcode-model-setup-tabs"
            label={t('setup.tabs')}
            value={tab}
            options={[{ value: 'byok', label: t('setup.tab.byok') }, { value: 'local', label: t('setup.tab.local') }]}
            onChange={setTab}
          />
        )}
        {error !== null && <p className={css.error} role="alert">{error}</p>}
        {body}
      </div>
    </Modal>
  )
}
