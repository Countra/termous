export type Language = 'zh-CN' | 'en-US'

export type ThemeMode = 'dark' | 'light'

export type PageKey = 'workbench' | 'hosts' | 'vault' | 'files' | 'forwards' | 'snippets' | 'settings'

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

export type HostPlatform = 'linux'

export type CredentialType = 'password' | 'private_key' | 'private_key_passphrase'

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export type InventoryStatus = 'idle' | 'collecting' | 'ready' | 'failed' | 'unsupported'

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

export type ForwardMode = 'local' | 'remote' | 'dynamic'

export type ForwardScope = 'session' | 'background_once' | 'background_profile'

export type ForwardStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export type ForwardPhase =
  | 'queued'
  | 'resolving_session'
  | 'resolving_auth'
  | 'dialing_ssh'
  | 'starting_listener'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed'

export interface ForwardProfile {
  id: string
  name: string
  description?: string
  mode: ForwardMode
  host_id: string
  bind_host: string
  bind_port: number
  target_host?: string
  target_port?: number
  created_at: string
  updated_at: string
}

export interface ForwardProfileInput {
  name: string
  description: string
  mode: ForwardMode
  host_id: string
  bind_host: string
  bind_port: number
  target_host: string
  target_port: number
}

export interface ForwardStartRequest {
  profile_id?: string
  scope?: ForwardScope
  session_id?: string
  host_id?: string
  name?: string
  description?: string
  mode?: ForwardMode
  bind_host?: string
  bind_port?: number
  target_host?: string
  target_port?: number
}

export interface ForwardInstance {
  id: string
  profile_id?: string
  session_id?: string
  host_id?: string
  name: string
  description?: string
  mode: ForwardMode
  scope: ForwardScope
  status: ForwardStatus
  phase: ForwardPhase
  progress: number
  status_message?: string
  bind_host: string
  bind_port: number
  bound_address?: string
  target_host?: string
  target_port?: number
  target_address?: string
  active_connections: number
  total_connections: number
  bytes_in: number
  bytes_out: number
  started_at: string
  stopped_at?: string
  last_error?: string
}

export interface ForwardEvent {
  type: string
  forward: ForwardInstance
  message?: string
}

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
  platform: HostPlatform
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

export interface LinuxSystemInfo {
  hostname?: string
  os_name?: string
  os_version?: string
  os_pretty_name?: string
  kernel?: string
  architecture?: string
  cpu_model?: string
  cpu_cores?: number
  cpu_frequency_mhz?: number
  memory_total_bytes?: number
  uptime_seconds?: number
  collected_at?: string
}

export type LinuxMonitorStatus = 'warming' | 'ready' | 'paused' | 'failed' | 'unsupported'

export interface LinuxMonitorCPU {
  usage_percent: number
  total_delta: number
  idle_delta: number
  load_average?: LinuxMonitorLoadAverage
}

export interface LinuxMonitorLoadAverage {
  one_minute: number
  five_minutes: number
  fifteen_minutes: number
  running_tasks: number
  total_tasks: number
  latest_pid: number
}

export interface LinuxMonitorMemory {
  total_bytes: number
  available_bytes: number
  used_bytes: number
  used_percent: number
  swap_total_bytes: number
  swap_used_bytes: number
}

export interface LinuxMonitorNetwork {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_bytes_per_sec: number
  tx_bytes_per_sec: number
  is_loopback: boolean
}

export interface LinuxMonitorDisk {
  filesystem: string
  type: string
  mountpoint: string
  total_bytes: number
  used_bytes: number
  available_bytes: number
  used_percent: number
  severity: 'normal' | 'warning' | 'critical'
}

export interface LinuxMonitorSnapshot {
  status: LinuxMonitorStatus
  collected_at: string
  interval_seconds: number
  cpu: LinuxMonitorCPU
  memory: LinuxMonitorMemory
  networks: LinuxMonitorNetwork[]
  disks: LinuxMonitorDisk[]
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
  inventory_status?: InventoryStatus
  inventory_message?: string
  linux_system_info?: LinuxSystemInfo
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
  platform: HostPlatform
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
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
  snippets: CodeSnippet[]
  settings: Settings
  terminalFonts: TerminalFont[]
}
