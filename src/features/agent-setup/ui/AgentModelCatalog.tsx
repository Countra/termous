import { Alert, Button, Empty, Input, Tag, Tooltip } from 'antd'
import { FlaskConical, RefreshCw, Search, SlidersHorizontal, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAgentModelRunnable, type AgentModel, type AgentModelProvider } from '#entities/agent'
import { uiStyles } from '#shared/ui'
import styles from './AgentModelCatalog.module.scss'

interface AgentModelCatalogProps {
  provider: AgentModelProvider
  models: AgentModel[]
  defaultModelId?: string
  disabled: boolean
  refreshing: boolean
  onRefresh: () => void
  onEdit: (model: AgentModel) => void
  onTest: (model: AgentModel) => void
  onSetDefault: (model: AgentModel) => void
}

export function AgentModelCatalog({
  provider,
  models,
  defaultModelId,
  disabled,
  refreshing,
  onRefresh,
  onEdit,
  onTest,
  onSetDefault,
}: AgentModelCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return models
    return models.filter((model) => (
      model.display_name.toLocaleLowerCase().includes(normalized)
      || model.remote_model_id.toLocaleLowerCase().includes(normalized)
      || model.owned_by?.toLocaleLowerCase().includes(normalized)
    ))
  }, [models, query])
  const status = !provider.enabled ? 'disabled'
    : provider.refresh_status === 'ready' && provider.last_refresh_error_code ? 'readyWarning'
      : provider.refresh_status

  return (
    <div className={styles['model-catalog']}>
      <div className={styles['catalog-toolbar']}>
        <Input
          allowClear
          value={query}
          prefix={<Search size={14} aria-hidden="true" />}
          aria-label={t('settings.agent.catalog.search')}
          placeholder={t('settings.agent.catalog.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          icon={<RefreshCw size={15} />}
          loading={refreshing}
          disabled={disabled}
          onClick={onRefresh}
        >
          {t('settings.agent.catalog.refresh')}
        </Button>
      </div>

      <CatalogState provider={provider} status={status} />

      <div className={styles['catalog-list']}>
        {visible.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query
              ? t('settings.agent.catalog.noResults')
              : t(provider.refresh_status === 'never'
                ? 'settings.agent.catalog.neverEmpty'
                : 'settings.agent.catalog.empty')}
          />
        ) : visible.map((model) => {
          const available = isAgentModelRunnable(model, provider)
          return (
            <article key={model.id} className={styles['catalog-row']}>
              <div className={styles['catalog-model-copy']}>
                <div>
                  <strong>{model.display_name}</strong>
                  {defaultModelId === model.id ? <Tag color="processing">{t('settings.agent.models.default')}</Tag> : null}
                  {model.availability === 'missing' ? <Tag color="default">{t('settings.agent.catalog.missing')}</Tag> : null}
                  {!model.capabilities_confirmed ? <Tag>{t('settings.agent.catalog.conservative')}</Tag> : null}
                </div>
                <span>{model.remote_model_id}{model.owned_by ? ` · ${model.owned_by}` : ''}</span>
              </div>
              <div className={styles['catalog-capabilities']}>
                <span>{formatTokens(model.context_window_tokens)} {t('settings.agent.catalog.context')}</span>
                {model.supports_images ? <span>{t('settings.agent.catalog.images')}</span> : null}
                {model.supports_reasoning ? <span>{t('settings.agent.catalog.reasoning')}</span> : null}
              </div>
              <div className={styles['catalog-actions']}>
                <Action
                  title={t('settings.agent.catalog.setDefault')}
                  icon={<Star size={15} fill={defaultModelId === model.id ? 'currentColor' : 'none'} />}
                  disabled={disabled || !available || defaultModelId === model.id}
                  onClick={() => onSetDefault(model)}
                />
                <Action
                  title={t('settings.agent.models.test')}
                  icon={<FlaskConical size={15} />}
                  disabled={disabled || !available}
                  onClick={() => onTest(model)}
                />
                <Action
                  title={t('settings.agent.catalog.editCapabilities')}
                  icon={<SlidersHorizontal size={15} />}
                  disabled={disabled}
                  onClick={() => onEdit(model)}
                />
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function CatalogState({ provider, status }: {
  provider: AgentModelProvider
  status: string
}) {
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
  const errorDescription = warning
    ? catalogErrorDescription(provider.last_refresh_error_code)
    : undefined
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

function Action({ title, icon, disabled, onClick }: {
  title: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip title={title} rootClassName={uiStyles.tooltip}>
      <Button type="text" icon={icon} aria-label={title} disabled={disabled} onClick={onClick} />
    </Tooltip>
  )
}

function formatTokens(value: number) {
  return value >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(1))}M`
    : value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}K` : String(value)
}
