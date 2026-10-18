import { Button, Switch } from 'antd'
import { ClipboardCopy } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsErrorCode, useSettingsModule } from '#entities/settings'
import { useSystemClipboardOperation, systemClipboardReasonKey } from '#entities/system-clipboard'
import { SettingsDetails, SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'

export function SystemClipboardSetting({ disabled }: { disabled: boolean }) {
  const importing = useSystemClipboardOperation('import_files')
  const publishing = useSystemClipboardOperation('publish_files')
  if (!importing.visible && !publishing.visible) return null
  const capabilityUnavailable = !importing.available && !publishing.available
  return <SystemClipboardPreference disabled={disabled} capabilityUnavailable={capabilityUnavailable}
    reason={importing.visible ? importing.reason : publishing.reason} />
}

// 未确认或未适配的平台不挂载设置订阅，恢复能力时再读取用户偏好。
function SystemClipboardPreference({ disabled, capabilityUnavailable, reason }: {
  disabled: boolean; capabilityUnavailable: boolean; reason?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const module = useSettingsModule('desktop_clipboard', { refreshOnFocus: true })
  const value = module.snapshot?.value.enabled
  const unavailable = !module.available || module.snapshot?.state.status === 'unavailable'
  const locked = disabled || module.busy || unavailable || capabilityUnavailable || typeof value !== 'boolean'
  const conflict = settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT'

  return <SettingsGroup title={t('settings.rdpFileExchange')} icon={<ClipboardCopy size={16} aria-hidden="true" />}>
    <SettingsField label={t('settings.systemFileClipboard')} htmlFor={id}
      description={t('settings.systemFileClipboardHint')} descriptionId={`${id}-hint`}
      control={<Switch id={id} checked={value === true} disabled={locked} loading={module.busy}
        aria-describedby={`${id}-hint ${id}-boundary`}
        onChange={enabled => { if (!locked) void module.update({ enabled }) }} />}>
      <p id={`${id}-boundary`} className={styles.hint}>{t('settings.systemFileClipboardBoundary')}</p>
      <SettingsDetails summary={t('settings.systemFileClipboardDetailsTitle')}>{t('settings.systemFileClipboardDetails')}</SettingsDetails>
      {(unavailable || capabilityUnavailable) && <p className={styles.hint} role="status">
        {t(unavailable ? 'settings.systemFileClipboardUnavailable' : systemClipboardReasonKey(reason))}
      </p>}
      {module.error && <p role="alert" className={styles.error}>
        {t(conflict ? 'settings.conflict' : 'settings.systemFileClipboardFailed')}
        <Button type="link" size="small" disabled={disabled || module.busy} onClick={() => void module.refresh()}>{t('app.retry')}</Button>
      </p>}
    </SettingsField>
  </SettingsGroup>
}
