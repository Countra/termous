import { Button, Input, Select, Tooltip } from 'antd'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelListState, AgentModelSource } from '#entities/agent'
import { customSelectStyles, uiStyles } from '#shared/ui'
import styles from './AgentModelCatalog.module.scss'

interface AgentModelCatalogToolbarProps {
  query: string
  state: AgentModelListState
  source: AgentModelSource | 'all'
  disabled: boolean
  refreshing: boolean
  onQueryChange: (value: string) => void
  onStateChange: (value: AgentModelListState) => void
  onSourceChange: (value: AgentModelSource | 'all') => void
  onRefresh: () => void
  onAdd: () => void
}

export function AgentModelCatalogToolbar({
  query,
  state,
  source,
  disabled,
  refreshing,
  onQueryChange,
  onStateChange,
  onSourceChange,
  onRefresh,
  onAdd,
}: AgentModelCatalogToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className={styles['catalog-toolbar']} data-testid="agent-model-catalog-toolbar">
      <Input
        allowClear
        value={query}
        prefix={<Search size={14} aria-hidden="true" />}
        aria-label={t('settings.agent.catalog.search')}
        placeholder={t('settings.agent.catalog.search')}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className={styles['catalog-filters']}>
        <Select
          value={state}
          aria-label={t('settings.agent.catalog.stateFilter')}
          className={customSelectStyles.select}
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          options={(['active', 'removed', 'all'] as AgentModelListState[]).map((value) => ({
            value,
            label: t(`settings.agent.catalog.filterState.${value}`),
          }))}
          onChange={onStateChange}
        />
        <Select
          value={source}
          aria-label={t('settings.agent.catalog.sourceFilter')}
          className={customSelectStyles.select}
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          options={(['all', 'sync', 'manual'] as const).map((value) => ({
            value,
            label: t(`settings.agent.catalog.filterSource.${value}`),
          }))}
          onChange={onSourceChange}
        />
        <Tooltip title={t('settings.agent.catalog.refresh')} rootClassName={uiStyles.tooltip}>
          <Button
            aria-label={t('settings.agent.catalog.refresh')}
            icon={<RefreshCw size={15} />}
            loading={refreshing}
            disabled={disabled}
            onClick={onRefresh}
          />
        </Tooltip>
        <Button type="primary" icon={<Plus size={15} />} disabled={disabled} onClick={onAdd}>
          {t('settings.agent.catalog.add')}
        </Button>
      </div>
    </div>
  )
}
