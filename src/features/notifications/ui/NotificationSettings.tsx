import { Alert, Button, Switch } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { NotificationCapabilities, NotificationPreferences } from '#common/contracts'
import styles from './NotificationSettings.module.scss'

export function NotificationSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
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
  return <section className={styles.settings} aria-label={t('notifications.settings.title')}>
    <div className={styles.heading}><strong>{t('notifications.settings.title')}</strong><p>{t(!bridge ? 'notifications.settings.desktopOnly' : state?.supported === false ? 'notifications.settings.unsupported' : 'notifications.settings.hint')}</p></div>
    {error && <Alert type="error" title={t('notifications.settings.error')} action={<Button size="small" onClick={() => void refresh()}>{t('app.retry')}</Button>} />}
    {(['enabled', 'agent', 'file', 'approval'] as const).map((key) => <div className={styles.row} key={key}>
      <span>{t(`notifications.settings.${key}`)}</span>
      <Switch aria-label={t(`notifications.settings.${key}`)} checked={state?.preferences[key] ?? false} loading={busy}
        disabled={disabled || busy || !bridge || !state || !state.supported || (key !== 'enabled' && !state.preferences.enabled)}
        onChange={(checked) => { if (state) void refresh({ ...state.preferences, [key]: checked }) }} />
    </div>)}
  </section>
}
