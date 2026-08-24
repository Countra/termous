import { Switch } from 'antd'
import { Activity, MonitorPlay, RotateCw } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettings as ConnectionSettingsValue } from '#common/contracts'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './ConnectionSettings.module.scss'

interface ConnectionSettingsProps {
  value: ConnectionSettingsValue
  disabled: boolean
  onChange: (settings: ConnectionSettingsValue) => Promise<void>
}

export function ConnectionSettings({ value, disabled, onChange }: ConnectionSettingsProps) {
  const { t } = useTranslation()

  return (
    <div className={surfaceStyles.surface}>
      <div className={surfaceStyles.header}>
        <Activity size={18} aria-hidden="true" />
        <h2>{t('settings.connectionSection')}</h2>
      </div>
      <div className={styles.rows}>
        <SettingRow
          icon={<Activity size={15} aria-hidden="true" />}
          title={t('settings.sshKeepalive')}
          hint={t('settings.sshKeepaliveHint')}
          checked={value.ssh_keepalive_enabled}
          disabled={disabled}
          onChange={(checked) => void onChange({ ...value, ssh_keepalive_enabled: checked })}
        />
        <SettingRow
          icon={<MonitorPlay size={15} aria-hidden="true" />}
          title={t('settings.remoteDesktopAutoReconnect')}
          hint={t('settings.remoteDesktopAutoReconnectHint')}
          checked={value.remote_desktop_auto_reconnect_enabled}
          disabled={disabled}
          onChange={(checked) => void onChange({ ...value, remote_desktop_auto_reconnect_enabled: checked })}
        />
        <SettingRow
          icon={<RotateCw size={15} aria-hidden="true" />}
          title={t('settings.forwardAutoReconnect')}
          hint={t('settings.forwardAutoReconnectHint')}
          checked={value.forward_auto_reconnect_enabled}
          disabled={disabled}
          onChange={(checked) => void onChange({ ...value, forward_auto_reconnect_enabled: checked })}
        />
      </div>
      <p className={styles.note}>{t('settings.connectionLimits')}</p>
    </div>
  )
}

function SettingRow({
  checked,
  disabled,
  hint,
  icon,
  onChange,
  title,
}: {
  checked: boolean
  disabled: boolean
  hint: string
  icon: ReactNode
  onChange: (checked: boolean) => void
  title: string
}) {
  const hintId = useId()

  return (
    <div className={styles.row}>
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <div className={styles.copy}>
        <strong>{title}</strong>
        <p id={hintId}>{hint}</p>
      </div>
      <Switch
        aria-describedby={hintId}
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}
