import type { ConnectionSettings } from '#common/contracts'

export const defaultConnectionSettings: ConnectionSettings = {
  ssh_keepalive_enabled: false,
  forward_auto_reconnect_enabled: false,
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
  }
}

export function connectionSettingsEqual(
  left: ConnectionSettings,
  right: ConnectionSettings,
) {
  return left.ssh_keepalive_enabled === right.ssh_keepalive_enabled
    && left.forward_auto_reconnect_enabled === right.forward_auto_reconnect_enabled
}
