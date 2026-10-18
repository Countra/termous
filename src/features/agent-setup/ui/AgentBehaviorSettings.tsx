import { Select, Switch } from 'antd'
import { Check, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import styles from './AgentSetup.module.scss'
import behaviorStyles from './AgentBehaviorSettings.module.scss'

export function AgentBehaviorSettings({ editor, policyAvailable }: { editor: AgentConfigurationEditor; policyAvailable: boolean }) {
  const { t } = useTranslation()
  const { draft, busy, change } = editor
  const toggles = [
    { key: 'connectOnBind', section: 'profileBinding', label: 'toggle' },
    { key: 'showTokenUsage', section: 'turnUsage', label: 'toggle' },
    { key: 'approvalBypass', section: 'policy', label: 'approval' },
  ] as const
  return <section className={styles.surface}>
    <header className={styles['section-title']}><Settings2 size={16} aria-hidden="true" /><h2>{t('settings.agent.configuration.behavior')}</h2></header>
    <div className={`${styles['section-body']} ${styles['agent-setting-list']}`}>
      <section className={styles['agent-setting-row']}>
        <div className={styles['agent-setting-copy']}>
          <strong>{t('settings.agent.concurrency.title')}</strong><span>{t('settings.agent.concurrency.description')}</span>
        </div>
        <Select aria-label={t('settings.agent.concurrency.title')} value={draft.maxConcurrentRuns} disabled={busy}
          className={`${customSelectStyles.select} ${behaviorStyles.select}`}
          classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${behaviorStyles.popup}` } }}
          placement="bottomRight" popupMatchSelectWidth={160} virtual={false} listHeight={288}
          options={Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: String(index + 1) }))}
          optionRender={option => <span className={behaviorStyles.option}>
            <span>{option.label}</span>
            {option.value === draft.maxConcurrentRuns && <Check size={14} aria-hidden="true" />}
          </span>}
          onChange={maxConcurrentRuns => change({ maxConcurrentRuns })} />
      </section>
      {toggles.map(({ key, section, label }) => <section key={key} className={styles['agent-setting-row']}>
        <div className={styles['agent-setting-copy']}>
          <strong>{t(`settings.agent.${section}.title`)}</strong><span>{t(`settings.agent.${section}.description`)}</span>
          {key === 'approvalBypass' && !policyAvailable && <span>{t('settings.agent.policy.unavailable')}</span>}
        </div>
        <Switch aria-label={t(`settings.agent.${section}.${label}`)} checked={draft[key]}
          disabled={busy || key === 'approvalBypass' && !policyAvailable} onChange={value => change({ [key]: value })} />
      </section>)}
    </div>
  </section>
}
