import { Alert, Button, Switch } from 'antd'
import { Bell } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsModule } from '#entities/settings'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './NotificationSettings.module.scss'

const notificationCategories = ['agent', 'file', 'approval', 'cloud'] as const

export function NotificationSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { snapshot, error, busy, refresh, update } = useSettingsModule('notifications')
  const desktopOnly = !snapshot || snapshot.state.reason === 'desktop_only'
  const supported = snapshot?.state.supported === true
  const preferences = snapshot?.value
  const unavailable = disabled || busy || Boolean(error) || !supported
  const categoriesDisabled = unavailable || preferences?.enabled !== true

  return (
    <section className={surfaceStyles.surface} aria-labelledby={`${id}-title`}>
      <div className={surfaceStyles.header}>
        <Bell size={18} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t('notifications.settings.title')}</h2>
      </div>
      <div className={styles.row}>
        <div>
          <strong id={`${id}-enabled`}>{t('notifications.settings.enabled')}</strong>
          <p className={surfaceStyles.hint} id={`${id}-hint`}>{t(desktopOnly ? 'notifications.settings.desktopOnly' : !supported ? 'notifications.settings.unsupported' : 'notifications.settings.hint')}</p>
        </div>
        <Switch
          aria-labelledby={`${id}-enabled`}
          aria-describedby={`${id}-hint`}
          checked={preferences?.enabled === true}
          loading={busy}
          disabled={unavailable}
          onChange={(enabled) => { void update({ enabled }) }}
        />
      </div>
      {error && <Alert className={styles.error} type="error" title={t('notifications.settings.error')} action={<Button size="small" disabled={disabled || busy} onClick={() => void refresh()}>{t('app.retry')}</Button>} />}
      <div className={styles.categories} data-disabled={categoriesDisabled}>
        {notificationCategories.map((key) => (
          <div className={styles.row} key={key}>
            <span id={`${id}-${key}`}>{t(`notifications.settings.${key}`)}</span>
            <Switch
              aria-labelledby={`${id}-${key}`}
              checked={preferences?.[key] === true}
              loading={busy}
              disabled={categoriesDisabled}
              onChange={(checked) => { void update({ [key]: checked }) }}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
