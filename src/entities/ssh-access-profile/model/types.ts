import type { FileAccessProfile } from '#entities/file-access-profile'
import type { AuthMethod } from '#entities/host'

export interface SSHAccessProfile {
  id: string
  host_id: string
  name: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  proxy_id?: string
  jump_ssh_profile_id?: string
  fingerprint?: string
  fingerprint_policy: string
  is_default: boolean
  sort_order: number
  created_at: string
  updated_at: string
  last_connected_at?: string
}

export interface SSHAccessProfileInput {
  name: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  proxy_id: string
  jump_ssh_profile_id: string
  fingerprint: string
  fingerprint_policy: string
}

export interface SSHAccessProfileDraft extends Omit<SSHAccessProfileInput, 'port'> {
  port: number | null
}

export interface SSHAccessProfileValidationErrors {
  name?: 'too_long'
  address?: 'required' | 'too_long'
  port?: 'range'
  username?: 'required' | 'too_long'
  credential_id?: 'required'
  jump_ssh_profile_id?: 'self_reference'
}

export interface ProvisionedSSHAccessProfile {
  ssh: SSHAccessProfile
  file: FileAccessProfile
}

export interface SSHAccessProfileReferences {
  companion_files: number
  forward_profiles: number
  remote_desktop_routes: number
  jump_profile_consumers: number
  total: number
  blocking_total: number
}
