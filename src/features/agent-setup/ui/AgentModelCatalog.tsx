import { useMemo, useState } from 'react'
import { Alert, Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AgentModel,
  AgentModelListState,
  AgentModelProvider,
  AgentModelSource,
} from '#entities/agent'
import { AgentModelCatalogRow } from './AgentModelCatalogRow.tsx'
import { AgentModelCatalogToolbar } from './AgentModelCatalogToolbar.tsx'
import styles from './AgentModelCatalog.module.scss'

interface AgentModelCatalogProps {
  provider: AgentModelProvider
  models: AgentModel[]
  defaultModelId?: string
  disabled: boolean
  refreshing: boolean
  onRefresh: () => void
  onAdd: () => void
  onEdit: (model: AgentModel) => void
  onTest: (model: AgentModel) => void
  onSetDefault: (model: AgentModel) => void
  onRemove: (model: AgentModel) => void
  onRestore: (model: AgentModel) => void
}

export function AgentModelCatalog({
  provider,
  models,
  defaultModelId,
  disabled,
  refreshing,
  onRefresh,
  onAdd,
  onEdit,
  onTest,
  onSetDefault,
  onRemove,
  onRestore,
}: AgentModelCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<AgentModelListState>('active')
  const [source, setSource] = useState<AgentModelSource | 'all'>('all')
  const visible = useMemo(() => filterModels(models, query, state, source), [models, query, source, state])
  const status = !provider.enabled ? 'disabled'
    : provider.refresh_status === 'ready' && provider.last_refresh_error_code ? 'readyWarning'
      : provider.refresh_status

  return (
    <div className={styles['model-catalog']}>
      <AgentModelCatalogToolbar
        query={query}
        state={state}
        source={source}
        disabled={disabled}
        refreshing={refreshing}
        onQueryChange={setQuery}
        onStateChange={setState}
        onSourceChange={setSource}
        onRefresh={onRefresh}
        onAdd={onAdd}
      />
      <CatalogState provider={provider} status={status} />
      <div className={styles['catalog-list']} data-testid="agent-model-catalog-list">
        {visible.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query
              ? t('settings.agent.catalog.noResults')
              : t(state === 'removed'
                ? 'settings.agent.catalog.noRemoved'
                : provider.refresh_status === 'never'
                  ? 'settings.agent.catalog.neverEmpty'
                  : 'settings.agent.catalog.empty')}
          />
        ) : visible.map((model) => (
          <AgentModelCatalogRow
            key={model.id}
            provider={provider}
            model={model}
            defaultModelId={defaultModelId}
            disabled={disabled}
            onEdit={onEdit}
            onTest={onTest}
            onSetDefault={onSetDefault}
            onRemove={onRemove}
            onRestore={onRestore}
          />
        ))}
      </div>
    </div>
  )
}

function filterModels(
  models: AgentModel[],
  query: string,
  state: AgentModelListState,
  source: AgentModelSource | 'all',
) {
  const normalized = query.trim().toLocaleLowerCase()
  return models.filter((model) => {
    const removed = Boolean(model.removed_at)
    if (state === 'active' && removed) return false
    if (state === 'removed' && !removed) return false
    if (source !== 'all' && model.source !== source) return false
    return !normalized
      || model.display_name.toLocaleLowerCase().includes(normalized)
      || model.remote_model_id.toLocaleLowerCase().includes(normalized)
      || model.owned_by?.toLocaleLowerCase().includes(normalized)
  })
}

function CatalogState({ provider, status }: { provider: AgentModelProvider; status: string }) {
  const { t } = useTranslation()
  const warning = status === 'failed' || status === 'stale' || status === 'readyWarning'
  if (status === 'ready') {
    return (
      <div className={styles['catalog-state-line']}>
        <span>{t('settings.agent.catalog.status.ready')}</span>
        {provider.last_refresh_success_at ? (
          <time dateTime={provider.last_refresh_success_at}>
            {t('settings.agent.catalog.lastSynced', {
              time: new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
                .format(new Date(provider.last_refresh_success_at)),
            })}
          </time>
        ) : null}
      </div>
    )
  }
  const errorDescription = warning ? catalogErrorDescription(provider.last_refresh_error_code) : undefined
  return (
    <Alert
      type={warning ? 'warning' : 'info'}
      showIcon
      title={t(`settings.agent.catalog.stateTitle.${status}`)}
      description={t(errorDescription ?? `settings.agent.catalog.stateDescription.${status}`)}
    />
  )
}

function catalogErrorDescription(code?: string) {
  switch (code) {
    case 'invalid_config':
    case 'timeout':
    case 'connect_failed':
    case 'authentication_failed':
    case 'rate_limited':
    case 'invalid_response':
    case 'response_too_large':
    case 'catalog_fetch_failed':
      return `settings.agent.catalog.errorDescription.${code}`
    default:
      return undefined
  }
}
