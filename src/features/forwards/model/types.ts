import type { ForwardInstance, ForwardProfile } from '#entities/forward'
import type { Host } from '#entities/host'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export interface ForwardManagementData {
  hosts: Host[]
  sshAccessProfiles: SSHAccessProfile[]
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
}

export interface ForwardTemporaryIntent {
  key: number
  hostId: string
  sshProfileId: string
}

export interface ForwardSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
  ssh_profile_id?: string
}
