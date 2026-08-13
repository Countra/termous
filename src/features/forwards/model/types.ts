import type { ForwardInstance, ForwardProfile } from '#entities/forward'
import type { Host } from '#entities/host'

export interface ForwardManagementData {
  hosts: Host[]
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
}

export interface ForwardSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
}
