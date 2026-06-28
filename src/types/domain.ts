export type Language = 'zh-CN' | 'en-US'

export type ThemeMode = 'dark' | 'light'

export type PageKey = 'workbench' | 'hosts' | 'vault' | 'files' | 'snippets' | 'settings'

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

export type TerminalFontFamily = string

export type TerminalFontKind = 'builtin' | 'imported'

export interface TerminalFont {
  id: TerminalFontFamily
  kind: TerminalFontKind
  display_name: string
  family_name: string
  file_name?: string
  size_bytes?: number
  sha256?: string
  created_at?: string
}

export interface RemoteFileEntry {
  name: string
  path: string
  kind: RemoteFileKind
  size: number
  mode?: string
  permissions?: string
  permission_octal?: string
  modified_at?: string
  is_hidden: boolean
  target?: string
}

export interface RemoteDirectoryListing {
  host_id: string
  file_session_id?: string
  path: string
  parent_path: string
  entries: RemoteFileEntry[]
  read_at: string
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

export type FileSessionHostKeyReason = 'unknown' | 'changed'

export interface FileSessionHostKey {
  reason: FileSessionHostKeyReason
  host_id?: string
  address: string
  port: number
  host_key_type: string
  fingerprint_sha256: string
  expected?: string
  actual?: string
  last_seen_at?: string
}

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
  host_key?: FileSessionHostKey
}

export interface TransferTask {
  id: string
  host_id: string
  file_session_id?: string
  type: TransferType
  status: TransferStatus
  source_paths: string[]
  target_path: string
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

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export type TerminalThemeMode = 'follow_app' | 'dark' | 'light'

export type SnippetShell = 'any' | 'sh' | 'bash' | 'zsh' | 'powershell' | 'cmd'

export type AuthMethod = 'password' | 'private_key' | 'system'

export type CredentialType = 'password' | 'private_key' | 'private_key_passphrase'

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export type SessionPhase =
  | 'queued'
  | 'resolving_auth'
  | 'dialing'
  | 'ssh_handshake_auth'
  | 'requesting_pty'
  | 'starting_shell'
  | 'starting_local_shell'
  | 'ready'
  | 'failed'
  | 'disconnected'

export type SessionKind = 'ssh' | 'local'

export type LocalShell = 'powershell' | 'cmd'

export interface Settings {
  language: Language
  terminal: TerminalSettings
}

export interface TerminalSettings {
  font_family: TerminalFontFamily
  font_size: number
  line_height: number
  letter_spacing: number
  cursor_style: TerminalCursorStyle
  cursor_blink: boolean
  theme_mode: TerminalThemeMode
  scrollback: 1000 | 5000 | 10000 | 50000
}

export interface CodeSnippet {
  id: string
  name: string
  description?: string
  command: string
  tags: string[]
  shell: SnippetShell
  favorite: boolean
  use_count: number
  last_used_at?: string
  created_at: string
  updated_at: string
}

export interface CodeSnippetInput {
  name: string
  description: string
  command: string
  tags: string[]
  shell: SnippetShell
  favorite: boolean
}

export interface Host {
  id: string
  name: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id?: string
  fingerprint?: string
  tags: string[]
  fingerprint_policy: string
  note?: string
  created_at?: string
  updated_at?: string
  last_connected_at?: string
}

export interface HostGroup {
  id: string
  name: string
  sort_order: number
  created_at?: string
  updated_at?: string
}

export interface CredentialView {
  id: string
  name: string
  type: CredentialType
  vault_id: string
  metadata: Record<string, string>
  fingerprint?: string
  bound_host_count: number
  created_at?: string
  updated_at?: string
  last_used_at?: string
}

export interface KnownHost {
  id: string
  host_id: string
  address: string
  port: number
  host_key_type: string
  fingerprint_sha256: string
  trusted_at?: string
  last_seen_at?: string
  created_at?: string
  updated_at?: string
}

export interface KnownHostInput {
  host_id?: string
  address: string
  port: number
  host_key_type: string
  fingerprint_sha256: string
}

export interface Session {
  id: string
  kind: SessionKind
  host_id?: string
  jump_host_id?: string
  status: SessionStatus
  status_message?: string
  phase?: SessionPhase
  progress?: number
  started_at: string
  connected_at?: string
  ended_at?: string
  last_error?: string
  exit_code?: number
  pty_cols: number
  pty_rows: number
}

export interface ApiErrorBody {
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface AppConfig {
  apiBaseUrl: string
  apiToken: string
  version?: string
  managed?: boolean
}

export interface AppBuildInfo {
  version: string
}

export interface CoreStatus {
  config: AppConfig
  fatal: CoreFatalEvent | null
  pid?: number
}

export interface CoreRuntimeInfo {
  name: string
  version: string
  pid: number
  addr: string
  uptime_seconds: number
  heartbeat_enabled: boolean
  heartbeat_timeout_ms: number
  last_heartbeat_at: string
  shutdown_in_progress: boolean
  shutdown_reason?: string
  shutdown_started_at?: string
}

export interface CoreFatalEvent {
  title: string
  message: string
  code: string
}

export interface HostInput {
  name: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id: string
  tags: string[]
  fingerprint_policy: string
  note: string
}

export interface CredentialInput {
  name: string
  type: CredentialType
  vault_id: string
  secret: string
  metadata: Record<string, string>
}

export interface AppData {
  hosts: Host[]
  groups: HostGroup[]
  credentials: CredentialView[]
  knownHosts: KnownHost[]
  sessions: Session[]
  fileSessions: FileSession[]
  snippets: CodeSnippet[]
  settings: Settings
  terminalFonts: TerminalFont[]
}
