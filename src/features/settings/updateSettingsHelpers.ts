import type { UpdatePreferences } from '../../../electron/updateTypes'

export type UpdatePreferenceKey = 'automatic_check' | 'check_interval' | 'automatic_download'
export type PendingPreferenceValues = Partial<Pick<UpdatePreferences, UpdatePreferenceKey>>

export function isPreferencePending(
  values: PendingPreferenceValues,
  key: UpdatePreferenceKey,
) {
  return Object.prototype.hasOwnProperty.call(values, key)
}
