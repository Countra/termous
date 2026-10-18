import type { MountSettingsState, SettingsSnapshot } from '#common/contracts'

export function decodeMountSettings(snapshot: SettingsSnapshot): MountSettingsState {
  if (snapshot.state.status === 'unavailable') throw new Error(String(snapshot.state.error ?? 'MOUNT_SETTINGS_UNAVAILABLE'))
  const { value, state } = snapshot
  const text = (input: unknown) => { if (typeof input !== 'string') throw new Error('SETTINGS_INVALID_RESPONSE'); return input }
  const number = (input: unknown) => { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) throw new Error('SETTINGS_INVALID_RESPONSE'); return input }
  return {
    cache_directory: text(value.cache_directory), cache_max_bytes: number(value.cache_max_bytes), cache_min_free_bytes: number(value.cache_min_free_bytes),
    default_directory: text(state.default_directory), active_cache_directory: text(state.active_cache_directory), next_cache_directory: text(state.next_cache_directory),
    active_cache_max_bytes: number(state.active_cache_max_bytes), active_cache_min_free_bytes: number(state.active_cache_min_free_bytes),
    restart_required: state.status === 'restart_required', ...(state.startup_warning === undefined ? {} : { startup_warning: text(state.startup_warning) }),
  }
}
