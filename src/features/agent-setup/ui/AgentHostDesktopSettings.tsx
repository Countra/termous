import { Button, Switch, Tooltip } from 'antd'
import { Camera, Info, Monitor, MousePointer2, ScanLine } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import styles from './AgentSetup.module.scss'
import desktopStyles from './AgentHostDesktopSettings.module.scss'

const permissions = [['Read', 'read', ScanLine], ['Capture', 'capture', Camera], ['Control', 'control', MousePointer2]] as const

export function AgentHostDesktopSettings({ editor, available }: { editor: AgentConfigurationEditor; available: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { draft, busy, change } = editor
  return <section className={styles.surface} aria-labelledby={`${id}-title`}>
    <header className={styles['section-title']}>
      <Monitor size={16} aria-hidden="true" /><h2 id={`${id}-title`}>{t('settings.agent.hostDesktop.title')}</h2>
      <Tooltip trigger={['hover', 'focus']} title={<div className={desktopStyles.help}>
        <p>{t('settings.agent.hostDesktop.description')}</p>
        <p>{t('settings.agent.hostDesktop.dependencies')}</p>
      </div>}>
        <Button className={desktopStyles['help-button']} type="text" size="small" aria-label={t('settings.agent.hostDesktop.details')} icon={<Info size={14} aria-hidden="true" />} />
      </Tooltip>
    </header>
    <div className={styles['section-body']}>
      <div className={desktopStyles.permissions}>
        {permissions.map(([kind, key, Icon]) => <div key={kind} className={desktopStyles.row}>
          <Icon className={desktopStyles.icon} size={18} aria-hidden="true" />
          <div className={desktopStyles.copy}>
            <label htmlFor={`${id}-${key}`}>{t(`settings.agent.hostDesktop.${key}`)}</label>
            <p id={`${id}-${key}-hint`}>{t(`settings.agent.hostDesktop.${key}Hint`)}</p>
          </div>
          <Switch id={`${id}-${key}`} checked={draft[`host${kind}`]} disabled={busy || !available}
            aria-describedby={`${id}-${key}-hint${kind === 'Control' ? ` ${id}-focus-hint` : ''}`}
            onChange={value => change(kind === 'Read' ? { hostRead: value, ...(!value ? { hostCapture: false, hostControl: false } : {}) }
              : kind === 'Capture' ? { hostCapture: value, ...(value ? { hostRead: true } : { hostControl: false }) }
              : { hostControl: value, ...(value ? { hostRead: true, hostCapture: true } : {}) })} />
        </div>)}
      </div>
      <p id={`${id}-focus-hint`} className={desktopStyles.note}><Info size={14} aria-hidden="true" />{t('settings.agent.hostDesktop.focusHint')}</p>
    </div>
  </section>
}
