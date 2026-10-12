import { Button, Switch } from 'antd'
import { ClipboardCopy } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsErrorCode, useSettingsModule } from '#entities/settings'
import styles from './RemoteDesktopSettings.module.scss'

export function SystemClipboardSetting({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const module = useSettingsModule('desktop_clipboard', { refreshOnFocus: true })
  const value = module.snapshot?.value.enabled
  const unavailable = !module.available || module.snapshot?.state.status === 'unavailable'
  const locked = disabled || module.busy || unavailable || typeof value !== 'boolean'
  const conflict = settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT'

  return <div className={styles.row}>
    <ClipboardCopy size={18} className={styles.icon} aria-hidden="true" />
    <div className={styles.copy}>
      <label htmlFor={id}>{t('settings.systemFileClipboard')}</label>
      <p id={`${id}-hint`}>{t('settings.systemFileClipboardHint')}</p>
      <p id={`${id}-boundary`}>{t('settings.systemFileClipboardBoundary')}</p>
    </div>
    <div className={styles.control}>
      <Switch id={id} checked={value === true} disabled={locked} loading={module.busy}
        aria-describedby={`${id}-hint ${id}-boundary`}
        onChange={enabled => { if (!locked) void module.update({ enabled }) }} />
    </div>
    {unavailable && <p className={styles.note}>{t('settings.systemFileClipboardUnavailable')}</p>}
    {module.error && <p role="alert" className={styles.error}>
      {t(conflict ? 'settings.conflict' : 'settings.systemFileClipboardFailed')}
      <Button type="link" size="small" disabled={disabled || module.busy} onClick={() => void module.refresh()}>{t('app.retry')}</Button>
    </p>}
  </div>
}
