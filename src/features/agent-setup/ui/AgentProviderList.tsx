import { Empty, Input } from 'antd'
import { Boxes, Cloud, KeyRound, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProvider } from '#entities/agent'
import styles from './AgentProviderManager.module.scss'

interface AgentProviderListProps {
  providers: AgentModelProvider[]
  selectedId?: string
  creating: boolean
  disabled: boolean
  modelCounts: ReadonlyMap<string, number>
  onSelect: (id: string) => void
}

export function AgentProviderList({
  providers,
  selectedId,
  creating,
  disabled,
  modelCounts,
  onSelect,
}: AgentProviderListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return providers
    return providers.filter((provider) => (
      provider.name.toLocaleLowerCase().includes(normalized)
      || provider.base_url.toLocaleLowerCase().includes(normalized)
    ))
  }, [providers, query])

  return (
    <aside className={styles['provider-sidebar']}>
      <div className={styles['provider-search']}>
        <Input
          allowClear
          value={query}
          prefix={<Search size={14} aria-hidden="true" />}
          aria-label={t('settings.agent.providers.search')}
          placeholder={t('settings.agent.providers.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={styles['provider-list']}>
        {visible.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query
              ? t('settings.agent.providers.noResults')
              : t('settings.agent.providers.empty')}
          />
        ) : visible.map((provider) => (
          <button
            key={provider.id}
            type="button"
            aria-pressed={!creating && selectedId === provider.id}
            className={[
              styles['provider-row'],
              !creating && selectedId === provider.id ? styles['is-active'] : '',
            ].filter(Boolean).join(' ')}
            disabled={disabled}
            onClick={() => onSelect(provider.id)}
          >
            <span className={styles['provider-row-icon']}><Cloud size={16} aria-hidden="true" /></span>
            <span className={styles['provider-row-copy']}>
              <strong>{provider.name}</strong>
              <small>{provider.base_url}</small>
              <span className={styles['provider-row-meta']}>
                <span>{t(`settings.agent.apiMode.${provider.api_mode === 'responses' ? 'responses' : 'chatCompletions'}`)}</span>
                <span><Boxes size={11} aria-hidden="true" />{t('settings.agent.providers.modelCount', {
                  count: modelCounts.get(provider.id) ?? 0,
                })}</span>
                <span className={provider.api_key_configured ? styles['has-secret'] : undefined}>
                  <KeyRound size={11} aria-hidden="true" />
                  {t(provider.api_key_configured
                    ? 'settings.agent.apiKey.configured'
                    : 'settings.agent.apiKey.notConfigured')}
                </span>
              </span>
            </span>
            <ProviderState provider={provider} />
          </button>
        ))}
      </div>
    </aside>
  )
}

function ProviderState({ provider }: { provider: AgentModelProvider }) {
  const { t } = useTranslation()
  const state = !provider.enabled ? 'disabled'
    : provider.refresh_status === 'ready' && provider.last_refresh_error_code ? 'readyWarning'
      : provider.refresh_status
  const label = t(`settings.agent.catalog.status.${state}`)
  const tone = state === 'readyWarning' ? 'ready-warning' : state
  return (
    <span
      className={`${styles['provider-row-state']} ${styles[`is-${tone}`]}`}
      aria-label={label}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  )
}
