import type { LoginItemResponse, UpdatePreferences } from '#common/contracts'
import { validateNotificationPreferences } from '#common/contracts'
import type { NotificationPreferencesStore } from '../notifications/preferences.ts'
import type { DesktopSettingsAdapter } from './runtime.ts'

export function notificationSettingsAdapter(store: () => NotificationPreferencesStore | null, supported: () => boolean): DesktopSettingsAdapter {
  return {
    read: () => ({ value: { ...store()?.get() }, state: { status: store() ? 'applied' : 'unavailable', supported: supported() } }),
    apply: async (patch) => {
      const preferences = store()
      if (!preferences) throw new Error('SETTINGS_UNAVAILABLE')
      await preferences.set(validateNotificationPreferences({ ...preferences.get(), ...patch }))
    },
  }
}

export function updateSettingsAdapter(runtime: () => { getPreferences(): UpdatePreferences; updatePreferences(patch: unknown): Promise<UpdatePreferences> } | null): DesktopSettingsAdapter {
  return {
    read: () => {
      const preferences = runtime()?.getPreferences()
      if (!preferences) return { value: {}, state: { status: 'unavailable' } }
      const { automatic_check, check_interval, automatic_download, last_checked_at, revision } = preferences
      return { value: { automatic_check, check_interval, automatic_download }, state: { status: 'applied', last_checked_at, preferences_revision: revision } }
    },
    apply: async (patch) => {
      const updates = runtime()
      if (!updates) throw new Error('SETTINGS_UNAVAILABLE')
      await updates.updatePreferences(patch)
    },
  }
}

export function loginItemSettingsAdapter(adapter: { get(): LoginItemResponse; setEnabled(enabled: unknown): LoginItemResponse }): DesktopSettingsAdapter {
  const checked = (response: LoginItemResponse) => {
    if (!response.ok) throw new Error(`LOGIN_ITEM_${response.error.toUpperCase()}`)
    return response.value
  }
  return {
    read: () => {
      const { enabled, ...state } = checked(adapter.get())
      return { value: { enabled }, state: { ...state, status: state.available ? 'applied' : 'unavailable' } }
    },
    apply: (patch) => {
      if (Object.keys(patch).length !== 1 || typeof patch.enabled !== 'boolean') throw new Error('SETTINGS_INVALID_REQUEST')
      checked(adapter.setEnabled(patch.enabled))
    },
  }
}
