import { Activity, Info, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettings as ConnectionSettingsValue, ConnectionSettingsPatch } from '#common/contracts'
import { SettingsGroup } from '../controls/SettingsGroup'
import { ConnectionToggleSetting } from './ConnectionToggleSetting'
import styles from './ConnectionSettings.module.scss'

interface ConnectionSettingsProps {
  value: ConnectionSettingsValue
  disabled: boolean
  onChange: (patch: ConnectionSettingsPatch) => Promise<void>
}

export function ConnectionSettings({ value, disabled, onChange }: ConnectionSettingsProps) {
  const { t } = useTranslation()
  return (
    <div>
      <SettingsGroup title={t('settings.connectionSection')} icon={<Activity size={16} aria-hidden="true" />}>
        <ConnectionToggleSetting
          setting="ssh_keepalive_enabled"
          label={t('settings.sshKeepalive')}
          description={t('settings.sshKeepaliveHint')}
          checked={value.ssh_keepalive_enabled}
          disabled={disabled}
          onChange={onChange}
        />
      </SettingsGroup>
      <SettingsGroup title={t('settings.forwardSettings')} icon={<Network size={16} aria-hidden="true" />}>
        <ConnectionToggleSetting
          setting="forward_auto_reconnect_enabled"
          label={t('settings.forwardAutoReconnect')}
          description={t('settings.forwardAutoReconnectHint')}
          checked={value.forward_auto_reconnect_enabled}
          disabled={disabled}
          onChange={onChange}
        />
      </SettingsGroup>
      <p className={styles.note}><Info size={14} aria-hidden="true" />{t('settings.connectionLimits')}</p>
    </div>
  )
}
