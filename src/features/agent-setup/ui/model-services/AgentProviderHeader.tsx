import { Button, Tooltip } from 'antd'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProvider } from '#entities/agent'
import { EditorModeContext, uiStyles } from '#shared/ui'
import { AgentProviderPicker, ProviderState } from '../AgentProviderPicker.tsx'
import styles from './AgentProviderHeader.module.scss'

export function AgentProviderHeader({ providers, provider, creating, disabled, loading, modelCounts, onSelect, onCreate, onRefresh, onBack }: {
  providers: AgentModelProvider[]
  provider?: AgentModelProvider
  creating: boolean
  disabled: boolean
  loading: boolean
  modelCounts: ReadonlyMap<string, number>
  onSelect(id: string): void
  onCreate(): void
  onRefresh(): void
  onBack?: () => void
}) {
  const { t } = useTranslation()
  return (
    <header className={`${styles.header} ${creating ? styles['is-creating'] : ''}`}>
      {creating ? <div className={styles.creation}>
        <EditorModeContext mode="create" label={t('app.add')}
          title={<h3>{t('settings.agent.providers.new')}</h3>} />
      </div> : <div className={styles.selection}>
        <div className={styles.label}>
          <span>{t('settings.agent.providers.service')}</span>
          {provider && <ProviderState provider={provider} />}
        </div>
        <AgentProviderPicker providers={providers} selectedProvider={provider} disabled={disabled}
          modelCounts={modelCounts} onSelect={onSelect} />
      </div>}
      <div className={styles.actions}>
        <Tooltip title={t('settings.agent.providers.refresh')} rootClassName={uiStyles.tooltip}>
          <Button icon={<RefreshCw size={15} aria-hidden="true" />} type="text"
            aria-label={t('settings.agent.providers.refresh')} loading={loading} disabled={disabled}
            onClick={onRefresh} />
        </Tooltip>
        {creating && onBack && <Button type="text" icon={<ArrowLeft size={14} aria-hidden="true" />}
          disabled={disabled} onClick={onBack}>{t('settings.agent.providers.backToServices')}</Button>}
        {!creating && <Button icon={<Plus size={15} aria-hidden="true" />} disabled={disabled}
          onClick={onCreate}>{t('settings.agent.providers.add')}</Button>}
      </div>
    </header>
  )
}
