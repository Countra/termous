export interface MountConfig {
  name: string
  description: string
  file_profile_id: string
  target_os: string
  mount_point: string
  volume_name: string
  read_only: boolean
  case_sensitive: boolean
  attribute_ttl_seconds: number
  directory_ttl_seconds: number
  metadata_concurrency: number
}
export interface MountProfile extends MountConfig {
  id: string
  auto_start: boolean
  created_at: string
  updated_at: string
}
export interface MountInput extends MountConfig {
  auto_start?: boolean
  expected_updated_at?: string
}
export interface MountStartRequest { profile_id?: string; temporary?: MountInput }
export type MountAction = 'sync' | 'reconnect' | 'restart' | 'stop'
export interface MountFailure { operation: string; message: string; at: string }
export interface MountUploadSummary {
  active_files: number
  finalizing_files: number
  stopping_files?: number
  cleaning_files?: number
  cleanup_failed_files?: number
  buffered_files: number
  failed_files: number
  accepted_bytes: number
  transferred_bytes: number
  pending_bytes: number
  progress_kind?: 'confirmed' | 'transport' | 'mixed'
  reason?: string
  error?: string
}
export interface MountInstance extends MountConfig {
  id: string
  profile_id?: string
  start_origin: 'manual' | 'startup'
  state: 'starting' | 'running' | 'failed' | 'stopped'
  phase: string
  mounted: boolean
  retained: boolean
  open_handles: number
  dirty_nodes: number
  uploads?: MountUploadSummary
  started_at: string
  stopped_at?: string
  failure?: MountFailure
  host_key_challenge_id?: string
}
export interface MountEnvironment {
  platform: string
  architecture: string
  build_supported: boolean
  available: boolean
  dependency: string
  dependency_version?: string
  reason?: 'build_unsupported' | 'platform_unsupported' | 'dependency_missing' | 'dependency_incompatible' | 'dependency_error' | 'detection_canceled'
  message: string
  help_url?: string
  free_drives: string[]
}
