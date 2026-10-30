/** One provider's endpoint, key, model discovery and model picks. */

import { useMemo, useState } from 'react'
import {
  Button, Checkbox, IconChevronLeftOutlineRegular, IconInspectOutlineRegular, IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelKey } from './locales.ts'
import { isHttpUrl, ROUTE_PATTERN, SETUP_PROTOCOLS, slugRoute } from './providers.ts'
import type { SavedModel, SavedRoute, SetupOperations } from './setup-operations.ts'
import css from './ModelSetup.module.css'

/** The `model` namespace translate the setup surfaces read. */
export type SetupTranslate = (key: ModelKey, params?: Record<string, unknown>) => string

/** What the form edits: a catalog preset, a local runtime, a custom endpoint, or a saved route. */
export interface FormTarget {
  /** Fixed route id; absent for a new custom endpoint, whose id comes from its name. */
  readonly route?: string
  readonly name: string
  readonly api: string
  readonly baseURL: string
  readonly keyUrl?: string
  /** Local runtimes take no key. */
  readonly keyless?: boolean
  readonly existing?: SavedRoute
  /** Models already known (a local probe answered), shown before any fetch. */
  readonly initialModels?: readonly SavedModel[]
}

/** Props of {@link ProviderForm}. */
export interface ProviderFormProps {
  t: SetupTranslate
  target: FormTarget
  /** Route ids already configured, so a new custom endpoint cannot shadow one. */
  taken: readonly string[]
  operations: SetupOperations
  onBack: () => void
  onSaved: (route: string, firstModel: string) => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toSaved(model: LlmDiscoveredModel): SavedModel {
  return {
    id: model.id,
    ...model.name === undefined || model.name === model.id ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }
}

function merge(...lists: (readonly SavedModel[] | undefined)[]): SavedModel[] {
  const merged = new Map<string, SavedModel>()
  for (const list of lists) for (const model of list ?? []) merged.set(model.id, model)
  return [...merged.values()]
}

/**
 * Render the provider form.
 * @param props - see {@link ProviderFormProps}.
 * @returns the form stack.
 */
export function ProviderForm({ t, target, taken, operations, onBack, onSaved }: ProviderFormProps) {
  const existing = target.existing
  const initial = existing === undefined && target.initialModels === undefined
    ? null
    : merge(existing?.models, target.initialModels)
  const [displayName, setDisplayName] = useState(existing?.displayName ?? target.name)
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? target.baseURL)
  const [api, setApi] = useState(existing?.api ?? target.api)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [found, setFound] = useState<readonly SavedModel[] | null>(initial)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(existing?.models.map(model => model.id) ?? []))
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<'fetch' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const route = target.route ?? existing?.route ?? slugRoute(displayName)
  const custom = target.route === undefined && existing === undefined
  const nameError = !custom || displayName.trim() === '' ? null
    : !ROUTE_PATTERN.test(route) ? t('form.invalidName')
      : taken.includes(route) ? t('form.taken') : null
  const url = baseURL.trim()
  const urlError = url !== '' && !isHttpUrl(url) ? t('form.invalidUrl') : null
  const typedKey = key.trim()
  const ready = busy === null && nameError === null && isHttpUrl(url) && displayName.trim() !== ''

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return (found ?? []).filter(model => query === ''
      || model.id.toLowerCase().includes(query) || (model.name ?? '').toLowerCase().includes(query))
  }, [found, filter])

  const fetchModels = async (): Promise<void> => {
    setBusy('fetch')
    setError(null)
    try {
      const listed = await operations.discover({
        baseURL: url,
        api,
        ...typedKey !== '' ? { apiKey: typedKey } : existing === undefined ? {} : { provider: existing.route },
      })
      setFound(merge(existing?.models, listed.map(toSaved)))
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    const models = (found ?? []).filter(model => selected.has(model.id))
    const first = models[0]
    if (first === undefined) {
      setError(t('form.needModel'))
      return
    }
    setBusy('save')
    setError(null)
    try {
      await operations.saveRoute({
        route,
        displayName: displayName.trim(),
        api,
        baseURL: url,
        ...typedKey === '' ? {} : { apiKey: typedKey },
        keyed: target.keyless !== true && (typedKey !== '' || existing?.apiKeyEnv !== undefined),
        models,
      })
      onSaved(route, first.id)
    } catch (failure) {
      setError(message(failure))
      setBusy(null)
    }
  }

  const toggle = (id: string, on: boolean): void => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  return (
    <div className={css.stack}>
      <div className={css.actions}>
        <Button size="sm" icon={<IconChevronLeftOutlineRegular />} onClick={onBack}>{t('form.back')}</Button>
      </div>
      <label className={css.field}>
        <span className={css.label}>{t('form.name')}</span>
        <input className={css.textInput} value={displayName} aria-label={t('form.name')}
          onChange={(event) => { setDisplayName(event.target.value) }} />
      </label>
      {nameError !== null && <p className={css.error}>{nameError}</p>}
      <label className={css.field}>
        <span className={css.label}>{t('form.baseUrl')}</span>
        <input className={css.textInput} value={baseURL} aria-label={t('form.baseUrl')} spellCheck={false}
          onChange={(event) => { setBaseURL(event.target.value) }} />
      </label>
      {urlError !== null && <p className={css.error}>{urlError}</p>}
      <label className={css.field}>
        <span className={css.label}>{t('form.protocol')}</span>
        <select className={css.select} value={api} aria-label={t('form.protocol')}
          onChange={(event) => { setApi(event.target.value) }}>
          {SETUP_PROTOCOLS.map(choice => <option key={choice} value={choice}>{t(`protocol.${choice}`)}</option>)}
        </select>
      </label>
      {target.keyless !== true && (
        <div className={css.field}>
          <span className={css.label}>{t('form.key')}</span>
          <div className={css.keyRow}>
            <input className={css.textInput} type={showKey ? 'text' : 'password'} value={key} aria-label={t('form.key')}
              autoComplete="off" spellCheck={false}
              placeholder={existing?.apiKeyEnv === undefined ? '' : t('form.keyKeep')}
              onChange={(event) => { setKey(event.target.value) }} />
            <button type="button" className={css.iconButton} aria-pressed={showKey}
              aria-label={t(showKey ? 'form.keyHide' : 'form.keyShow')} title={t(showKey ? 'form.keyHide' : 'form.keyShow')}
              onClick={() => { setShowKey(!showKey) }}>
              <IconInspectOutlineRegular />
            </button>
          </div>
          {target.keyUrl !== undefined && (
            <a className={css.link} href={target.keyUrl} target="_blank" rel="noreferrer">
              <IconLinkOutlineRegular size={12} /> {t('form.keyLink')}
            </a>
          )}
        </div>
      )}
      <div className={css.actions}>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={!ready}
          onClick={() => { void fetchModels() }}>
          {t(busy === 'fetch' ? 'form.fetching' : 'form.fetch')}
        </Button>
        {found !== null && found.length > 0 && (
          <span className={css.actionsEnd}>
            <span className={css.hint}>{t('form.selected', { count: selected.size })}</span>
            <Button size="sm" onClick={() => { setSelected(new Set(visible.map(model => model.id))) }}>{t('form.selectAll')}</Button>
            <Button size="sm" onClick={() => { setSelected(new Set()) }}>{t('form.clear')}</Button>
          </span>
        )}
      </div>
      {found === null
        ? <p className={css.hint}>{t('form.fetchFirst')}</p>
        : found.length === 0
          ? <p className={css.hint}>{t('form.noModels')}</p>
          : (
            <>
              {found.length > 8 && (
                <input className={css.textInput} value={filter} placeholder={t('form.filter')} aria-label={t('form.filter')}
                  onChange={(event) => { setFilter(event.target.value) }} />
              )}
              <div className={css.models} role="group" aria-label={t('form.models')}>
                {visible.map(model => (
                  <div className={css.modelRow} key={model.id}>
                    <Checkbox label={model.id} checked={selected.has(model.id)} onChange={(on) => { toggle(model.id, on) }} />
                    {model.contextWindow !== undefined && (
                      <span className={css.modelMeta}>
                        {t('form.context', { tokens: `${String(Math.round(model.contextWindow / 1000))}K` })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      <div className={css.actions}>
        <span className={css.actionsEnd}>
          <Button size="sm" onClick={onBack}>{t('form.cancel')}</Button>
          <Button variant="primary" size="sm" disabled={busy !== null || selected.size === 0}
            onClick={() => { void save() }}>
            {t(busy === 'save' ? 'form.saving' : 'form.save')}
          </Button>
        </span>
      </div>
    </div>
  )
}
