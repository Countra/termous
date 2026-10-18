import type { MountCacheState, MountCacheClear } from '#common/contracts'
import type { SettingsGateway } from '#entities/settings'

export interface MountSettingsGateway extends SettingsGateway {
  mountCache?: () => Promise<MountCacheState>
  clearMountCache?: () => Promise<MountCacheClear>
}
