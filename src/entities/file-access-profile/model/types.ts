export type FileAccessEngine = string

export type FileAccessProfileHostScope = 'required' | 'optional' | 'forbidden'

export interface SFTPAccessConfig extends Record<string, unknown> {
  ssh_profile_id: string
}

export interface FileAccessProfileLifecycleOwner {
  kind: string
  id: string
}

export interface FileAccessProfile {
  id: string
  host_id?: string
  name: string
  engine: FileAccessEngine
  engine_config_version: number
  config: Record<string, unknown>
  lifecycle_owner?: FileAccessProfileLifecycleOwner
  /** v1 SFTP 兼容投影，仅供旧调用链读取。 */
  sftp?: SFTPAccessConfig
  is_default: boolean
  sort_order: number
  last_directory?: string
  created_at: string
  updated_at: string
}

export interface SFTPFileAccessProfile extends FileAccessProfile {
  host_id: string
  engine: 'sftp'
  engine_config_version: 1
  config: SFTPAccessConfig
  sftp: SFTPAccessConfig
}

export interface FileAccessEngineDescriptor {
  id: FileAccessEngine
  config_versions: number[]
  current_config_version: number
  host_scope: FileAccessProfileHostScope
  capabilities: string[]
}

export interface FileAccessProfileReferences {
  agent_sessions: number
  active_file_sessions: number
  is_default: boolean
  peer_profiles: number
  lifecycle_owner?: FileAccessProfileLifecycleOwner
  blocking_total: number
}

export interface FileAccessProfileCreateInput {
  host_id?: string
  name: string
  engine: FileAccessEngine
  engine_config_version: number
  config: Record<string, unknown>
}

export interface FileAccessProfilePatchInput {
  name?: string
  engine_config_version?: number
  config?: Record<string, unknown>
}

export interface FileAccessProfileMetadataInput {
  name: string
}

export interface FileAccessProfileValidationErrors {
  name?: 'required' | 'too_long'
}
