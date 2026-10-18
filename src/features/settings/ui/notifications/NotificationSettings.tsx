import { Alert, Button, Switch } from 'antd'
import { ArrowLeftRight, Bell, Bot, Cloud, Info, ShieldCheck } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsModule } from '#entities/settings'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './NotificationSettings.module.scss'

const notificationCategories = [
  { key: 'agent', icon: Bot },
  { key: 'file', icon: ArrowLeftRight },
  { key: 'approval', icon: ShieldCheck },
  { key: 'cloud', icon: Cloud },
] as const
type NotificationPreferenceKey = typeof notificationCategories[number]['key'] | 'enabled'

export function NotificationSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { snapshot, error, busy, available, refresh, update } = useSettingsModule('notifications')
  const [pendingKey, setPendingKey] = useState<NotificationPreferenceKey | null>(null)
  const desktopOnly = !available || snapshot?.state.reason === 'desktop_only'
  const supported = snapshot?.state.supported === true && snapshot.state.status === 'applied'
  const preferences = snapshot?.value
  const unavailable = disabled || busy || pendingKey !== null || Boolean(error) || !supported
  const categoriesDisabled = unavailable || preferences?.enabled !== true
  const notice = error ? null
    : busy && !snapshot ? 'notifications.settings.loading'
      : desktopOnly ? 'notifications.settings.desktopOnly'
        : snapshot?.state.supported === false ? 'notifications.settings.unsupported'
          : !supported ? 'notifications.settings.unavailable' : null
  const changePreference = (key: NotificationPreferenceKey, checked: boolean) => {
    if (unavailable || key !== 'enabled' && categoriesDisabled) return
    setPendingKey(key)
    void update({ [key]: checked }).finally(() => setPendingKey(null))
  }

  return (
    <section className={surfaceStyles.surface} aria-labelledby={`${id}-title`}>
      <div className={surfaceStyles.header}>
        <Bell size={16} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t('notifications.settings.title')}</h2>
      </div>
      <div className={styles.controls}>
        <div className={styles.master}>
          <div>
            <label htmlFor={`${id}-enabled`}>{t('notifications.settings.enabled')}</label>
            <p className={styles.hint} id={`${id}-hint`}>{t('notifications.settings.hint')}</p>
            <p className={styles.footnote} id={`${id}-paused`} role="status">
              {supported && !error && preferences?.enabled === false && <span>{t('notifications.settings.paused')} </span>}
              {t('notifications.settings.centreHint')}
            </p>
          </div>
          <Switch
            id={`${id}-enabled`}
            aria-describedby={`${id}-hint`}
            checked={preferences?.enabled === true}
            loading={pendingKey === 'enabled' || busy && !snapshot}
            disabled={unavailable}
            onChange={(enabled) => changePreference('enabled', enabled)}
          />
        </div>
        <fieldset className={styles.categories} disabled={categoriesDisabled} data-disabled={categoriesDisabled}
          aria-describedby={supported && !error && preferences?.enabled === false ? `${id}-paused` : undefined}>
          <legend>{t('notifications.settings.categories')}</legend>
          {notificationCategories.map(({ key, icon: Icon }) => (
            <label className={styles.category} htmlFor={`${id}-${key}`} key={key}>
              <Icon size={16} aria-hidden="true" />
              <span>{t(`notifications.sources.${key}`)}</span>
              <Switch
                id={`${id}-${key}`}
                size="small"
                aria-label={t(`notifications.sources.${key}`)}
                checked={preferences?.[key] === true}
                loading={pendingKey === key}
                disabled={categoriesDisabled}
                onChange={(checked) => changePreference(key, checked)}
              />
            </label>
          ))}
        </fieldset>
      </div>
      {error && <Alert className={styles.feedback} type="error" showIcon title={t('notifications.settings.error')}
        action={<Button size="small" disabled={disabled || busy} onClick={() => void refresh()}>{t('app.retry')}</Button>} />}
      {notice && <p className={styles.notice} role="status"><Info size={14} aria-hidden="true" />{t(notice)}</p>}
    </section>
  )
}
