import type { RemoteDesktopAccessProfileInput } from '#entities/remote-desktop'
import type { SSHAccessProfileInput } from '#entities/ssh-access-profile'
import type { HostAssetInput } from './types.ts'

export interface HostProvisionSSHInput extends SSHAccessProfileInput {
  draft_id: string
  jump_draft_id?: string
  is_default: boolean
  file_name: string
  file_is_default: boolean
}

export interface HostProvisionDesktopInput extends Omit<RemoteDesktopAccessProfileInput, 'host_id' | 'ssh_profile_id'> {
  draft_id: string
  ssh_draft_id?: string
  target_auth_password?: string
  is_default: boolean
}

export interface HostProvisionInput {
  client_request_id: string
  host: HostAssetInput
  ssh: HostProvisionSSHInput[]
  remote_desktops: HostProvisionDesktopInput[]
}
