import { Checkbox, Switch, Tooltip } from 'antd'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'
import { McpIcon } from '#shared/ui'
import styles from './IntegrationSourcePicker.module.scss'

export function IntegrationPickerItem({ source, policy, pending, update }: {
  source: IntegrationSelection['sources'][number]
  policy: IntegrationPolicy
  pending: string
  update: (policy: IntegrationPolicy) => Promise<void>
}) {
  const { t } = useTranslation()
  const enabled = source.enabled && !policy.disabled
  return <div className={styles.item} data-enabled={enabled}>
    <div className={styles['item-main']}>
      <span className={styles['item-icon']}>{source.kind === 'mcp' ? <McpIcon size={18} /> : <BookOpen size={17} />}</span>
      <div className={styles['item-copy']}>
        <Tooltip title={source.description ? `${source.name} · ${source.description}` : source.name}>
          <strong>{source.name}</strong>
        </Tooltip>
        {!source.enabled ? <span>{t('extensions.enableInSettings')}</span>
          : source.kind === 'skill' ? <Checkbox className={styles['skill-selection']}
            disabled={!enabled || !source.version || Boolean(pending)} checked={Boolean(source.version && policy.skill_version === source.version)}
            onChange={event => void update({ ...policy, skill_version: event.target.checked ? source.version : '' })}>
            {t('extensions.selectSkill')}
          </Checkbox>
          : source.kind === 'mcp' && source.connection && enabled ? <span className={styles.connection} data-state={source.connection}>
            <i />{t(`mcpPreparation.connectionStates.${source.connection}`)}</span>
            : source.description ? <span>{source.description}</span> : null}
      </div>
      <Switch size="small" checked={enabled} loading={pending === source.id} disabled={!source.enabled || Boolean(pending)}
        aria-label={`${t('extensions.sessionEnabled')} ${source.name}`} onChange={checked => void update({ ...policy, disabled: !checked })} />
    </div>
  </div>
}
