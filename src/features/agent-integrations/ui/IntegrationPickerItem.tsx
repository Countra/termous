import { Button, Switch, Tooltip } from 'antd'
import { BookOpen, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'
import { McpIcon } from '#shared/ui'
import { integrationSessionState, integrationTogglePolicy } from '../model/integrationSessionPolicy'
import styles from './IntegrationSourcePicker.module.scss'

export function IntegrationPickerItem({ source, policy, pending, update }: {
  source: IntegrationSelection['sources'][number]
  policy: IntegrationPolicy
  pending: string
  update: (policy: IntegrationPolicy) => Promise<void>
}) {
  const { t } = useTranslation()
  const { enabled, ready, needsSelection, updateAvailable } = integrationSessionState(source, policy)
  return <div className={styles.item} data-enabled={enabled}>
    <div className={styles['item-main']}>
      <span className={styles['item-icon']}>{source.kind === 'mcp' ? <McpIcon size={18} /> : <BookOpen size={17} />}</span>
      <div className={styles['item-copy']}>
        <Tooltip title={source.description ? `${source.name} · ${source.description}` : source.name}>
          <strong>{source.name}</strong>
        </Tooltip>
        {!source.enabled ? <span>{t('extensions.enableInSettings')}</span>
          : !ready ? <span>{t('extensions.unavailable')}</span>
          : needsSelection ? <span>{t('extensions.skillManual')}</span>
          : source.kind === 'mcp' && source.connection && enabled ? <span className={styles.connection} data-state={source.connection}>
            <i />{t(`mcpPreparation.connectionStates.${source.connection}`)}</span>
            : source.description ? <span>{source.description}</span> : null}
      </div>
      {updateAvailable && <Tooltip title={t('extensions.skillUpdateHint')} trigger={['hover', 'focus']}>
        <Button type="text" size="small" className={styles['version-action']} disabled={Boolean(pending)}
          icon={<RefreshCw size={14} aria-hidden="true" />} aria-label={`${t('extensions.skillUpdate')} ${source.name}`}
          onClick={() => void update({ ...policy, skill_version: source.version })} />
      </Tooltip>}
      <Tooltip title={source.enabled && ready && needsSelection ? t('extensions.skillManualHint') : undefined} trigger={['hover', 'focus']}>
        <Switch size="small" checked={enabled} loading={pending === source.id} disabled={!source.enabled || !ready || Boolean(pending)}
          aria-label={`${t('extensions.sessionEnabled')} ${source.name}`} onChange={checked => void update(integrationTogglePolicy(source, policy, checked))} />
      </Tooltip>
    </div>
  </div>
}
