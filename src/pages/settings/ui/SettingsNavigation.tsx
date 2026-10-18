import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsPages, type SettingsPageTabKey } from '../model/registry'
import styles from './SettingsWorkspace.module.scss'

const groups = ['basics', 'connections', 'intelligence', 'maintenance'] as const

export function SettingsNavigation({ active, disabled, onSelect }: {
  active: SettingsPageTabKey
  disabled: boolean
  onSelect(id: SettingsPageTabKey): void
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLElement>(null)
  const navigate = (event: KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key) || disabled) return
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }
  return <nav ref={root} className={styles.navigation} role="tablist" aria-label={t('settings.title')}
    aria-orientation="vertical" onKeyDown={navigate}>
    {groups.map(group => <div className={styles.group} key={group} role="presentation">
      <span className={styles['group-label']}>{t(`settings.groups.${group}`)}</span>
      {settingsPages.filter(entry => entry.group === group).map(entry => {
        const Icon = entry.icon
        return <button key={entry.id} type="button" role="tab" id={`settings-tab-${entry.id}`}
          aria-controls={`settings-panel-${entry.id}`} aria-selected={active === entry.id}
          tabIndex={active === entry.id ? 0 : -1} disabled={disabled}
          data-tour={'tour' in entry ? entry.tour : undefined} className={styles['nav-item']}
          onClick={() => onSelect(entry.id)}>
          <Icon size={16} aria-hidden="true" /><span>{t(entry.title)}</span>
        </button>
      })}
    </div>)}
  </nav>
}
