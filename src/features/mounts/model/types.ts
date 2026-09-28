import type { FileAccessProfile } from '#entities/file-access-profile'
import type { MountAction, MountEnvironment, MountInput, MountInstance, MountProfile, MountStartRequest } from '#entities/mount'

export interface MountWorkspaceProps {
  profiles: MountProfile[]
  instances: MountInstance[]
  environment?: MountEnvironment
  error: string
  connected: boolean
  fileProfiles: FileAccessProfile[]
  hosts: Array<{ id: string; name: string }>
  reload: () => Promise<{ profiles: MountProfile[]; environment: MountEnvironment } | undefined>
  save: (id: string | undefined, input: MountInput) => Promise<void>
  remove: (profile: MountProfile) => Promise<void>
  start: (input: MountStartRequest) => Promise<void>
  action: (id: string, action: MountAction, force?: boolean) => Promise<void>
}
