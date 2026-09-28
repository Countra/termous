import { Alert, Button, Switch } from 'antd'
import { Bell } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { NotificationCapabilities, NotificationPreferences } from '#common/contracts'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './NotificationSettings.module.scss'

const notificationCategories = ['agent', 'file', 'approval'] as const

export function NotificationSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const bridge = getTermousBridge()?.notifications
  const [state, setState] = useState<NotificationCapabilities | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const alive = useRef(true)
  const refresh = useCallback(async (value?: NotificationPreferences) => {
    if (!bridge || pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const result = value ? await bridge.setPreferences(value) : await bridge.status()
      if (alive.current) { setState(result); setError(false) }
    } catch { if (alive.current) { setError(true); setState(null) } }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }, [bridge])
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false } }, [refresh])
  const unavailable = disabled || busy || !bridge || !state || !state.supported
  const categoriesDisabled = unavailable || !state?.preferences.enabled

  return (
    <section className={surfaceStyles.surface} aria-labelledby={`${id}-title`}>
      <div className={surfaceStyles.header}>
        <Bell size={18} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t('notifications.settings.title')}</h2>
      </div>
      <div className={styles.row}>
        <div>
          <strong id={`${id}-enabled`}>{t('notifications.settings.enabled')}</strong>
          <p className={surfaceStyles.hint} id={`${id}-hint`}>{t(!bridge ? 'notifications.settings.desktopOnly' : state?.supported === false ? 'notifications.settings.unsupported' : 'notifications.settings.hint')}</p>
        </div>
        <Switch
          aria-labelledby={`${id}-enabled`}
          aria-describedby={`${id}-hint`}
          checked={state?.preferences.enabled ?? false}
          loading={busy}
          disabled={unavailable}
          onChange={(enabled) => { if (state) void refresh({ ...state.preferences, enabled }) }}
        />
      </div>
      {error && <Alert className={styles.error} type="error" title={t('notifications.settings.error')} action={<Button size="small" disabled={disabled || busy} onClick={() => void refresh()}>{t('app.retry')}</Button>} />}
      <div className={styles.categories} data-disabled={categoriesDisabled}>
        {notificationCategories.map((key) => (
          <div className={styles.row} key={key}>
            <span id={`${id}-${key}`}>{t(`notifications.settings.${key}`)}</span>
            <Switch
              aria-labelledby={`${id}-${key}`}
              checked={state?.preferences[key] ?? false}
              loading={busy}
              disabled={categoriesDisabled}
              onChange={(checked) => { if (state) void refresh({ ...state.preferences, [key]: checked }) }}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
