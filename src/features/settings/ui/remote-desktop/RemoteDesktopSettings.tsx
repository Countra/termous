import { MonitorPlay } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettings, ConnectionSettingsPatch } from '#common/contracts'
import { ConnectionToggleSetting } from '../connection/ConnectionToggleSetting'
import { SettingsGroup } from '../controls/SettingsGroup'
import { RdpRetentionSetting } from './RdpRetentionSetting'
import { SystemClipboardSetting } from './SystemClipboardSetting'

interface RemoteDesktopSettingsProps {
  value: ConnectionSettings
  disabled: boolean
  onChange: (patch: ConnectionSettingsPatch) => Promise<void>
}

export function RemoteDesktopSettings({ value, disabled, onChange }: RemoteDesktopSettingsProps) {
  const { t } = useTranslation()
  return <div>
    <SettingsGroup title={t('settings.rdpSettings')} icon={<MonitorPlay size={16} aria-hidden="true" />}>
      <ConnectionToggleSetting setting="remote_desktop_auto_reconnect_enabled"
        label={t('settings.remoteDesktopAutoReconnect')} description={t('settings.remoteDesktopAutoReconnectHint')}
        checked={value.remote_desktop_auto_reconnect_enabled} disabled={disabled} onChange={onChange} />
      <RdpRetentionSetting value={value} disabled={disabled} onChange={onChange} />
    </SettingsGroup>
    <SystemClipboardSetting disabled={disabled} />
  </div>
}
