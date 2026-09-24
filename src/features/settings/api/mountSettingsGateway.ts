import type { MountSettings, MountSettingsState } from '#common/contracts'

export interface MountSettingsGateway {
  mountSettings: () => Promise<MountSettingsState>
  updateMountSettings: (settings: MountSettings) => Promise<MountSettingsState>
}
