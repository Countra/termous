export type RemoteFileKind = 'file' | 'directory' | 'symlink' | 'other'

export type OverwritePolicy = 'ask' | 'overwrite' | 'skip' | 'rename'

export type TransferType =
  | 'upload_file'
  | 'upload_directory'
  | 'download_file'
  | 'download_directory'
  | 'remote_copy'
  | 'remote_move'

export type TransferStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type LocalGrantSource = 'picker' | 'drop' | 'clipboard'

export interface RemoteFileEntry {
  name: string
  path: string
  kind: RemoteFileKind
  size: number
  mode?: string
  permissions?: string
  permission_octal?: string
  modified_at?: string
  accessed_at?: string
  uid?: number
  gid?: number
  is_hidden: boolean
  target?: string
  extended?: SftpExtendedAttribute[]
}

export interface SftpExtendedAttribute {
  type: string
  data: string
}

export interface RemoteDirectoryListing {
  host_id: string
  file_session_id?: string
  path: string
  parent_path: string
  entries: RemoteFileEntry[]
  read_at: string
}

export type RemoteTextEncoding = 'utf-8'

export type RemoteTextLineEnding = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none'

export interface RemoteTextFile {
  file_session_id: string
  path: string
  name: string
  content: string
  encoding: RemoteTextEncoding
  has_bom: boolean
  line_ending: RemoteTextLineEnding
  language?: string
  size: number
  sha256: string
  modified_at?: string
  mode?: string
  permission_octal?: string
  loaded_at: string
}

export interface RemoteTextSaveRequest {
  path: string
  content: string
  base_sha256: string
  base_size: number
  base_modified_at?: string
  line_ending: RemoteTextLineEnding
  has_bom: boolean
  force: boolean
}

export interface RemoteTextSaveResult {
  file: RemoteTextFile
  entry: RemoteFileEntry
}

export interface RemoteImageFile {
  file_session_id: string
  path: string
  name: string
  content_type: string
  size: number
  sha256: string
  modified_at?: string
  loaded_at: string
}

export type FileOperationType = 'read_text' | 'save_text' | 'read_image'

export type FileOperationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type FileOperationPhase =
  | 'queued'
  | 'stat'
  | 'read'
  | 'decode'
  | 'verify'
  | 'write_temp'
  | 'replace'
  | 'reload'
  | 'done'

export interface FileOperationTask {
  id: string
  revision: number
  file_session_id: string
  host_id: string
  type: FileOperationType
  status: FileOperationStatus
  phase: FileOperationPhase
  phase_label?: string
  path: string
  total_bytes: number
  transferred_bytes: number
  remaining_bytes: number
  phase_total_bytes: number
  phase_transferred_bytes: number
  phase_progress_percent: number
  progress_percent: number
  speed_bytes_per_sec: number
  average_speed_bytes_per_sec: number
  eta_seconds?: number
  elapsed_seconds: number
  cancellable: boolean
  created_at: string
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export type FileSessionStatus = 'connecting' | 'connected' | 'waiting_trust' | 'disconnected' | 'failed'

export type FileSessionPhase =
  | 'queued'
  | 'resolving_auth'
  | 'dialing'
  | 'host_key_checking'
  | 'waiting_host_trust'
  | 'sftp_handshake'
  | 'ready'
  | 'failed'
  | 'disconnected'

export interface FileSession {
  id: string
  host_id: string
  source_session_id?: string
  status: FileSessionStatus
  status_message?: string
  phase?: FileSessionPhase
  progress?: number
  current_path: string
  started_at: string
  connected_at?: string
  ended_at?: string
  last_error?: string
  connection_generation?: number
  state_seq?: number
  error_code?: string
  retryable?: boolean
}

export interface TransferTask {
  id: string
  host_id: string
  file_session_id?: string
  type: TransferType
  status: TransferStatus
  source_paths: string[]
  target_path: string
  local_directory_path?: string
  total_bytes: number
  transferred_bytes: number
  remaining_bytes: number
  total_files: number
  completed_files: number
  current_file?: string
  progress_percent: number
  speed_bytes_per_sec: number
  average_speed_bytes_per_sec: number
  eta_seconds?: number
  elapsed_seconds: number
  cancellable: boolean
  retryable: boolean
  overwrite_policy: OverwritePolicy
  created_at: string
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export interface LocalGrantItem {
  id: string
  path?: string
  name: string
  kind: 'file' | 'directory'
  size?: number
}

export interface LocalFileGrant {
  id: string
  source: LocalGrantSource
  items: LocalGrantItem[]
  created_at: string
  expires_at: string
}

export interface FileBookmarkGroup {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface FileBookmarkGroupInput {
  name: string
}

export interface FileBookmarkGroupReorderItem {
  id: string
  sort_order: number
}

export interface FileBookmark {
  id: string
  name: string
  path: string
  group_id: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface FileBookmarkInput {
  name: string
  path: string
  group_id: string
}

export interface FileBookmarkReorderItem {
  id: string
  group_id: string
  sort_order: number
}

export interface LocalPathMapping {
  id: string
  name: string
  path: string
  sort_order: number
  available: boolean
  last_used_at?: string
  created_at: string
  updated_at: string
}

export interface LocalPathMappingInput {
  name: string
  path: string
}

export interface LocalPathMappingReorderItem {
  id: string
  sort_order: number
}

export type LocalTreeEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface LocalTreeEntry {
  name: string
  path: string
  relative_path?: string
  kind: LocalTreeEntryKind
  size: number
  modified_at?: string
  is_hidden?: boolean
  is_accessible?: boolean
  children_loaded?: boolean
  has_children: boolean
  error_message?: string
}
