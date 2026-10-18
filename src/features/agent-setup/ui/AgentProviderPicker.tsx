import { Select } from 'antd'
import { Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProvider } from '#entities/agent'
import { customSelectStyles } from '#shared/ui'
import styles from './AgentProviderPicker.module.scss'

export function AgentProviderPicker({ providers, selectedProvider, disabled, modelCounts, onSelect }: {
  providers: AgentModelProvider[]
  selectedProvider?: AgentModelProvider
  disabled: boolean
  modelCounts: ReadonlyMap<string, number>
  onSelect(id: string): void
}) {
  const { t } = useTranslation()
  return <Select
    className={`${customSelectStyles.select} ${styles.picker}`}
    classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['picker-popup']}` } }}
    aria-label={t('settings.agent.providers.search')}
    placeholder={t('settings.agent.providers.empty')}
    value={selectedProvider?.id}
    disabled={disabled || providers.length === 0}
    listHeight={320}
    showSearch={{ filterOption: (input, option) => `${option?.label} ${option?.provider.base_url}`.toLocaleLowerCase().includes(input.toLocaleLowerCase()) }}
    labelRender={() => <span className={styles['picker-label']}><Cloud size={15} aria-hidden="true" /><span>{selectedProvider?.name}</span></span>}
    options={providers.map(provider => ({ value: provider.id, label: provider.name, provider }))}
    optionRender={({ data: { provider } }) => <div className={styles['picker-option']}>
      <div><strong>{provider.name}</strong><ProviderState provider={provider} /></div>
      <small>{provider.base_url}</small>
      <span>{t(`settings.agent.apiMode.${provider.api_mode === 'responses' ? 'responses' : 'chatCompletions'}`)}
        <i aria-hidden="true">·</i>{t('settings.agent.providers.modelCount', { count: modelCounts.get(provider.id) ?? 0 })}</span>
    </div>}
    onChange={onSelect}
  />
}

export function ProviderState({ provider }: { provider: AgentModelProvider }) {
  const { t } = useTranslation()
  const state = !provider.enabled ? 'disabled'
    : provider.refresh_status === 'ready' && provider.last_refresh_error_code ? 'readyWarning'
      : provider.refresh_status
  const label = t(`settings.agent.catalog.status.${state}`)
  const tone = state === 'readyWarning' ? 'ready-warning' : state
  return (
    <span
      className={`${styles['provider-row-state']} ${styles[`is-${tone}`] ?? ''}`}
      aria-label={label}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  )
}
