import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostPlatform } from '#entities/host'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export interface HostAsset {
  id: string
  name: string
  platform: HostPlatform
  icon_id?: string
  group_id: string
  tags: string[]
  favorite: boolean
  note?: string
  last_accessed_at?: string
  created_at: string
  updated_at: string
}

export interface HostAssetInput {
  name: string
  platform: HostPlatform
  icon_id: string
  group_id: string
  tags: string[]
  favorite: boolean
  note: string
}

export interface HostAssetValidationErrors {
  name?: 'required' | 'too_long'
}

export interface HostAccessCatalog {
  host: HostAsset
  ssh: SSHAccessProfile[]
  files: FileAccessProfile[]
  remote_desktops: RemoteDesktopAccessProfile[]
}
