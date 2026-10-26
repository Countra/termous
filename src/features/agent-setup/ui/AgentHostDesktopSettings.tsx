import { Switch } from 'antd'
import { Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import styles from './AgentSetup.module.scss'

export function AgentHostDesktopSettings({ editor, available }: { editor: AgentConfigurationEditor; available: boolean }) {
  const { t } = useTranslation()
  const { draft, busy, change } = editor
  return <section className={styles.surface}>
    <header className={styles['section-title']}><Monitor size={16} aria-hidden="true" /><h2>{t('settings.agent.hostDesktop.title')}</h2></header>
    <div className={`${styles['section-body']} ${styles['agent-setting-list']}`}>
      <p>{t('settings.agent.hostDesktop.description')}</p>
      {(['Read', 'Capture', 'Control'] as const).map(kind => <section key={kind} className={styles['agent-setting-row']}>
        <strong>{t(`settings.agent.hostDesktop.${kind.toLowerCase()}`)}</strong>
        <Switch checked={draft[`host${kind}`]} disabled={busy || !available}
          aria-label={t(`settings.agent.hostDesktop.${kind.toLowerCase()}`)}
          onChange={value => change(kind === 'Read' ? { hostRead: value, ...(!value ? { hostCapture: false, hostControl: false } : {}) }
            : kind === 'Capture' ? { hostCapture: value, ...(value ? { hostRead: true } : { hostControl: false }) }
            : { hostControl: value, ...(value ? { hostRead: true, hostCapture: true } : {}) })} />
      </section>)}
    </div>
  </section>
}
