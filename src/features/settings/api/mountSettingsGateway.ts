import type { MountSettings, MountSettingsState, MountCacheState, MountCacheClear } from '#common/contracts'

export interface MountSettingsGateway {
  mountSettings: () => Promise<MountSettingsState>
  updateMountSettings: (settings: MountSettings) => Promise<MountSettingsState>
  mountCache?: () => Promise<MountCacheState>
  clearMountCache?: () => Promise<MountCacheClear>
}
