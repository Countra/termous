export type FileAccessEngine = 'sftp'

export interface SFTPAccessConfig {
  ssh_profile_id: string
}

interface FileAccessProfileBase {
  id: string
  host_id: string
  name: string
  is_default: boolean
  sort_order: number
  last_directory?: string
  created_at: string
  updated_at: string
}

export interface SFTPFileAccessProfile extends FileAccessProfileBase {
  engine: 'sftp'
  engine_config_version: 1
  sftp: SFTPAccessConfig
}

export type FileAccessProfile = SFTPFileAccessProfile

export interface FileAccessProfileMetadataInput {
  name: string
}

export interface FileAccessProfileValidationErrors {
  name?: 'required' | 'too_long'
}
