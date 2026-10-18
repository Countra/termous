import type { ConnectionSettings } from '#common/contracts'

export const defaultConnectionSettings: ConnectionSettings = {
  ssh_keepalive_enabled: false,
  forward_auto_reconnect_enabled: false,
  remote_desktop_auto_reconnect_enabled: true,
  rdp_unattended_timeout_minutes: 10,
}

export function normalizeConnectionSettings(
  settings: Partial<ConnectionSettings> | null | undefined,
): ConnectionSettings {
  return {
    ssh_keepalive_enabled: typeof settings?.ssh_keepalive_enabled === 'boolean'
      ? settings.ssh_keepalive_enabled
      : defaultConnectionSettings.ssh_keepalive_enabled,
    forward_auto_reconnect_enabled: typeof settings?.forward_auto_reconnect_enabled === 'boolean'
      ? settings.forward_auto_reconnect_enabled
      : defaultConnectionSettings.forward_auto_reconnect_enabled,
    remote_desktop_auto_reconnect_enabled: typeof settings?.remote_desktop_auto_reconnect_enabled === 'boolean'
      ? settings.remote_desktop_auto_reconnect_enabled
      : defaultConnectionSettings.remote_desktop_auto_reconnect_enabled,
    rdp_unattended_timeout_minutes: typeof settings?.rdp_unattended_timeout_minutes === 'number'
      && Number.isInteger(settings.rdp_unattended_timeout_minutes)
      && settings.rdp_unattended_timeout_minutes >= 1 && settings.rdp_unattended_timeout_minutes <= 30
      ? settings.rdp_unattended_timeout_minutes
      : defaultConnectionSettings.rdp_unattended_timeout_minutes,
  }
}
