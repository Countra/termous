import type {
  AppLanguage,
  AppTheme,
  Settings,
  TerminalFont,
} from '#common/contracts'
import type { CredentialView } from '#entities/credential'
import type {
  ConnectionProxy,
} from '#entities/connection-proxy'
import type {
  Host,
  HostGroup,
  HostReachability,
} from '#entities/host'

export type {
  AppBuildInfo,
  AppConfig,
  CoreFatalEvent,
  CoreStatus,
  DataPortabilityDatasetKey,
  DataPortabilityDatasetSummary,
  DataPortabilityApplyResult,
  DataPortabilityExportDialogResult,
  DataPortabilityFieldDifference,
  DataPortabilityImport,
  DataPortabilityImportDialogResult,
  DataPortabilityImportSelectionResult,
  DataPortabilityItemRef,
  DataPortabilityPlanItem,
  DataPortabilityPlanItemPage,
  DataPortabilityPlanItemQuery,
  DataPortabilityPlanRequest,
  DataPortabilityPlanStatus,
  DataPortabilityPlanSummary,
  DataPortabilityProgress,
  DataPortabilityResolution,
  DataPortabilityResolutionRequest,
  DataPortabilityRestartResult,
  DataPortabilityRestoreMode,
  DataPortabilityRestorePlan,
  DataPortabilitySummary,
  DataPortabilityWarning,
  AppearanceSettings,
  CompletionProviderId,
  CompletionProviderSettings,
  CompletionSettings,
  Settings,
  ShortcutActionOverride,
  ShortcutChord,
  ShortcutModifier,
  ShortcutSettings,
  ShortcutSettingsPatch,
  TerminalCursorStyle,
  TerminalFont,
  TerminalFontFamily,
  TerminalFontKind,
  TerminalSettings,
  TerminalThemeMode,
  TrayCommand,
  TrayMenuLabels,
  TrayMenuState,
  TrayRecentHost,
  WindowCloseBehavior,
  WindowSettings,
} from '#common/contracts'

export type {
  CredentialInput,
  CredentialType,
  CredentialView,
  PendingPrivateKeyPassphrase,
  PrivateKeyCredentialBundleInput,
  PrivateKeyCredentialBundleResult,
  SSHKeyAlgorithm,
  SSHKeyECDSACurve,
  SSHKeyGenerateRequest,
  SSHKeyInfo,
  SSHKeyInspectRequest,
  SSHKeyInspectResult,
  SSHKeyPair,
} from '#entities/credential'

export type {
  ConnectionProxy,
  ConnectionProxyInput,
  ConnectionProxyType,
} from '#entities/connection-proxy'

export type {
  AuthMethod,
  Host,
  HostGroup,
  HostIcon,
  HostInput,
  HostPlatform,
  HostReachability,
  HostReachabilityEvent,
  HostReachabilityStatus,
} from '#entities/host'

export type {
  HostKeyChallenge,
  HostKeyChallengeReason,
  HostKeyChallengeSnapshot,
  HostKeyChallengeState,
  HostKeyConsumerType,
  HostKeyDecisionAction,
  HostKeyEndpoint,
  HostKeyEndpointRole,
  HostKeyEvent,
  HostKeyEventType,
  HostKeyMaterial,
  HostKeyObservationContext,
  HostKeyResolution,
  HostKeyTrustRecord,
} from '#entities/host-key'

export type {
  GroupReorderItem,
  PageKey,
} from '#shared/model'

export type Language = AppLanguage

export type ThemeMode = AppTheme

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

export type SnippetShell = 'any' | 'sh' | 'bash' | 'zsh' | 'powershell' | 'cmd'

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export type InventoryStatus = 'idle' | 'collecting' | 'ready' | 'failed' | 'unsupported'

export type SessionCwdSource = 'none' | 'terminal' | 'files'

export type SessionCwdCapability = 'probing' | 'supported' | 'unsupported'

export type SessionCwdShellPhase = 'unknown' | 'prompt' | 'running' | 'alternate-screen'

export type SessionCwdObservationStatus = 'probing' | 'ready' | 'unavailable'

export type SessionCwdControlStatus =
  | 'inactive'
  | 'preparing'
  | 'ready'
  | 'degraded'
  | 'reconnect_required'
  | 'unsupported'

export type SessionCwdRefreshStatus = 'pending' | 'succeeded' | 'failed' | 'canceled'

export type SessionCwdOperationStatus =
  | 'queued'
  | 'waiting-idle'
  | 'publishing'
  | 'applying'
  | 'failed'

export interface SessionCwdOperation {
  id: string
  file_session_id: string
  path: string
  revision: number
  status: SessionCwdOperationStatus
  error_code?: string
  error?: string
}

export interface SessionCwdState {
  confirmed_path?: string
  desired_path?: string
  state_seq: number
  refresh_seq: number
  revision: number
  source: SessionCwdSource
  capability: SessionCwdCapability
  capability_cause?: string
  shell?: string
  shell_phase: SessionCwdShellPhase
  prompt_generation: number
  source_generation: number
  pending_operation?: SessionCwdOperation
  observation_status?: SessionCwdObservationStatus
  control_status?: SessionCwdControlStatus
  control_code?: string
  control_retryable?: boolean
  refresh_request_id?: string
  refresh_status?: SessionCwdRefreshStatus
  refresh_error_code?: string
  refresh_error?: string
}

export interface SessionCwdChangeRequest {
  operation_id: string
  base_revision: number
  file_session_id: string
  path: string
}

export type SessionPhase =
  | 'queued'
  | 'resolving_auth'
  | 'dialing'
  | 'ssh_handshake_auth'
  | 'waiting_host_trust'
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

export type ForwardStatus = 'starting' | 'waiting_host_trust' | 'running' | 'stopping' | 'stopped' | 'failed'

export type FirewallProvider = 'unsupported' | 'iptables' | 'nftables'

export type FirewallCapabilityStatus = 'ready' | 'unsupported' | 'permission_denied'

export type FirewallPrivilegeMode = 'none' | 'root' | 'sudo'

export type FirewallRuleDirection = 'inbound'

export type FirewallRuleFamily = 'ipv4' | 'ipv6'

export type FirewallRuleAction = 'allow' | 'drop' | 'reject'

export type FirewallRuleProtocol = 'any' | 'tcp' | 'udp' | 'icmp'

export type ForwardPhase =
  | 'queued'
  | 'resolving_session'
  | 'resolving_auth'
  | 'dialing_ssh'
  | 'waiting_host_trust'
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
  host_key_challenge_id?: string
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

export interface FirewallProviderInfo {
  provider: FirewallProvider
  present: boolean
  version?: string
  backend?: string
  message?: string
}

export interface FirewallProviderOption {
  provider: FirewallProvider
  status: FirewallCapabilityStatus
  present: boolean
  version?: string
  backend?: string
  privilege: FirewallPrivilegeMode
  supports_apply: boolean
  supports_save: boolean
  supports_counters: boolean
  message?: string
  recommended: boolean
}

export interface FirewallProviderList {
  providers: FirewallProviderOption[]
  default_provider: FirewallProvider
  privilege: FirewallPrivilegeMode
}

export interface FirewallCapability {
  status: FirewallCapabilityStatus
  provider: FirewallProvider
  provider_version?: string
  iptables_backend?: string
  privilege: FirewallPrivilegeMode
  supports_apply: boolean
  supports_save: boolean
  supports_counters: boolean
  message?: string
  detected_providers: FirewallProviderInfo[]
  unsupported_reasons?: string[]
}

export interface FirewallPortRange {
  from: number
  to: number
}

export interface FirewallRule {
  id: string
  provider: FirewallProvider
  direction: FirewallRuleDirection
  family: FirewallRuleFamily
  action: FirewallRuleAction
  protocol: FirewallRuleProtocol
  source?: string
  ports?: FirewallPortRange[]
  description?: string
  enabled: boolean
  managed: boolean
  editable: boolean
  readonly_reason?: string
  source_provider?: FirewallProvider
  edit_provider?: FirewallProvider
  cross_provider?: boolean
  counters_available?: boolean
  hit_count?: number
  byte_count?: number
  remote_present?: boolean
  disabled_local?: boolean
  source_kind?: 'remote' | 'local_disabled'
  signature?: string
  raw_ref?: string
  chain?: string
  position?: number
}

export interface FirewallSnapshot {
  session_id?: string
  capability: FirewallCapability
  rules: FirewallRule[]
  unsupported_rules?: FirewallRule[]
  snapshot_version: string
  synced_at: string
  warnings?: string[]
  raw_snapshot_digest?: string
}

export interface FirewallRuleInput {
  id?: string
  raw_ref?: string
  direction: FirewallRuleDirection
  family: FirewallRuleFamily
  action: FirewallRuleAction
  protocol: FirewallRuleProtocol
  source: string
  ports: FirewallPortRange[]
  description: string
  enabled: boolean
}

export interface FirewallDesiredState {
  snapshot_version: string
  rules: FirewallRuleInput[]
  confirm_risk: boolean
}

export interface FirewallPlanChange {
  type: 'create' | 'update' | 'delete'
  rule_id: string
  before?: FirewallRule
  after?: FirewallRule
}

export interface FirewallPlan {
  provider: FirewallProvider
  snapshot_version: string
  changes: FirewallPlanChange[]
  risk_warnings?: string[]
  allowed: boolean
  message?: string
}

export interface FirewallApplyResult {
  snapshot: FirewallSnapshot
  plan: FirewallPlan
  applied: boolean
  message?: string
}

export type FirewallPersistenceStatusKind =
  | 'unsupported'
  | 'ready'
  | 'missing_tools'
  | 'permission_denied'
  | 'file_saved'
  | 'service_enabled'
  | 'partial'

export interface FirewallInstallCommand {
  id: string
  title: string
  command: string
  risk: 'low' | 'medium'
}

export interface FirewallInstallPlan {
  provider: FirewallProvider
  package_manager?: string
  commands: FirewallInstallCommand[]
  missing_tools?: string[]
  requires_root: boolean
  warnings?: string[]
  confirmation_required: boolean
}

export interface FirewallPersistenceStatus {
  provider: FirewallProvider
  supported: boolean
  status: FirewallPersistenceStatusKind
  home_dir?: string
  rules_path?: string
  metadata_path?: string
  service_name?: string
  service_installed: boolean
  service_enabled: boolean
  systemd_available: boolean
  missing_tools?: string[]
  package_manager?: string
  install_available: boolean
  install_plan?: FirewallInstallPlan
  last_saved_at?: string
  message?: string
  warnings?: string[]
}

export interface FirewallSaveResult {
  provider: FirewallProvider
  saved: boolean
  status?: FirewallPersistenceStatusKind
  rules_path?: string
  service_name?: string
  service_enabled: boolean
  requires_install: boolean
  install_plan?: FirewallInstallPlan
  message: string
  warnings?: string[]
}

export interface FirewallPersistenceInstallResult {
  provider: FirewallProvider
  success: boolean
  status: FirewallPersistenceStatus
  message: string
}

export type CompletionProviderStatus =
  | 'idle'
  | 'building'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'disabled'

export interface CompletionProviderState {
  id: string
  status: CompletionProviderStatus
  error_code?: string
  retryable?: boolean
}

export type CompletionIndexStatus = 'building' | 'ready' | 'degraded'

export type CompletionPromptObservationStatus =
  | 'waiting'
  | 'preparing'
  | 'ready'
  | 'reconnect_required'
  | 'degraded'
  | 'unsupported'
  | 'disabled'

export interface CompletionPromptObservationState {
  status: CompletionPromptObservationStatus
  error_code?: string
  retryable?: boolean
}

export interface CompletionStatus {
  status: CompletionIndexStatus
  index_generation: number
  source_generation: number
  prompt_observation: CompletionPromptObservationState
  provider_states: CompletionProviderState[]
}

export type CompletionTrigger = 'typing' | 'manual'

export interface CompletionQuery {
  request_id: string
  source_generation: number
  shell_id: string
  prompt_generation: number
  line: string
  cursor_utf16: number
  trigger: CompletionTrigger
  max_items: number
}

export type CompletionSource = string

export interface CompletionItem {
  id: string
  kind: 'command' | 'directory'
  source: CompletionSource
  label: string
  detail?: string
  insert_text: string
  replace_start_utf16: number
  replace_end_utf16: number
  sources: CompletionSource[]
}

export interface CompletionResult extends CompletionStatus {
  request_id: string
  is_incomplete: boolean
  items: CompletionItem[]
}

export interface CodeSnippet {
  id: string
  group_id: string
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
  group_id: string
  name: string
  description: string
  command: string
  tags: string[]
  shell: SnippetShell
  favorite: boolean
}

export interface CodeSnippetGroup {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CodeSnippetGroupInput {
  name: string
  sort_order?: number
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
  network?: LinuxNetworkInfo | null
  collected_at?: string
}

export type LinuxNetworkStatus = 'ready' | 'partial' | 'unavailable' | 'failed'

export type LinuxIPAddressFamily = 'ipv4' | 'ipv6'

export interface LinuxIPAddress {
  family: LinuxIPAddressFamily
  address: string
  prefix_length: number
  scope?: string
}

export interface LinuxNetworkInterface {
  index: number
  name: string
  oper_state?: string
  mac_address?: string
  mtu?: number
  addresses: LinuxIPAddress[]
}

export interface LinuxNetworkInfo {
  status: LinuxNetworkStatus
  message?: string
  interfaces: LinuxNetworkInterface[]
}

export type LinuxMonitorStatus = 'warming' | 'ready' | 'paused' | 'failed' | 'unsupported'

export interface LinuxMonitorCPU {
  usage_percent: number
  total_delta: number
  idle_delta: number
  load_average?: LinuxMonitorLoadAverage
  cores: LinuxMonitorCPUCore[]
}

export interface LinuxMonitorCPUCore {
  name: string
  usage_percent: number
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

export interface LinuxMonitorDiskIODevice {
  name: string
  read_bytes_per_sec: number
  write_bytes_per_sec: number
  read_iops: number
  write_iops: number
  read_latency_ms: number
  write_latency_ms: number
  busy_percent: number
  in_flight: number
}

export interface LinuxMonitorDiskIO {
  status: LinuxMonitorStatus
  devices: LinuxMonitorDiskIODevice[]
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
  disk_io: LinuxMonitorDiskIO
  disks: LinuxMonitorDisk[]
}

export type RemoteProcessSort = 'cpu' | 'memory' | 'pid' | 'name' | 'runtime'

export type RemoteProcessTerminateSignal = 'term' | 'kill'

export interface RemoteProcessQuery {
  query?: string
  pid?: number
  port?: number
  sort?: RemoteProcessSort
  limit?: number
}

export interface RemoteProcessPort {
  protocol: string
  local_address: string
  local_port: number
  pid?: number
  process_name?: string
  raw?: string
}

export interface RemoteProcessSummary {
  pid: number
  ppid: number
  user: string
  state: string
  cpu_percent: number
  memory_percent: number
  rss_bytes: number
  runtime_seconds: number
  name: string
  command_line: string
  listening_ports?: number[]
  warnings?: string[]
  permission_state?: string
}

export interface RemoteProcessListResult {
  items: RemoteProcessSummary[]
  ports: RemoteProcessPort[]
  total: number
  filtered: number
  collected_at: string
  warnings?: string[]
}

export interface RemoteProcessDetail {
  summary: RemoteProcessSummary
  full_command_line?: string
  cwd?: string
  executable?: string
  status?: Record<string, string>
  ports?: RemoteProcessPort[]
  warnings?: string[]
  collected_at: string
}

export interface RemoteProcessTerminateRequest {
  signal: RemoteProcessTerminateSignal
}

export interface RemoteProcessTerminateResult {
  pid: number
  signal: RemoteProcessTerminateSignal
  attempted: boolean
  message: string
}

export type SystemServiceCapabilityStatus = 'ready' | 'read_only' | 'unsupported' | 'manager_unavailable' | 'unknown'

export type SystemServiceManageMode = 'direct' | 'sudo' | 'read_only'

export type SystemServiceRuntimeFilter = '' | 'running' | 'stopped' | 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'reloading' | 'maintenance' | 'refreshing'

export type SystemServiceSort = 'name' | 'description' | 'runtime' | 'unit_file'

export type SystemServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'reset_failed' | 'enable' | 'disable' | 'mask' | 'unmask'

export type SystemServiceOperationPhase = 'queued' | 'enqueued' | 'verifying' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled'

export interface SystemServiceCapability {
  provider: string
  available: boolean
  manageable: boolean
  status: SystemServiceCapabilityStatus
  message?: string
  version?: string
  manager_state?: string
  manage_mode: SystemServiceManageMode
  journal_readable: boolean
  warnings: string[]
  collected_at: string
}

export interface SystemServiceQuery {
  query?: string
  runtime_state?: SystemServiceRuntimeFilter
  unit_file_state?: string
  sort?: SystemServiceSort
  order?: 'asc' | 'desc'
  limit?: number
}

export interface SystemServiceSummary {
  id: string
  names: string[]
  description?: string
  load_state: string
  active_state: string
  sub_state: string
  unit_file_state: string
  template: boolean
}

export interface SystemServiceListResult {
  items: SystemServiceSummary[]
  total: number
  filtered: number
  running: number
  failed: number
  collected_at: string
  warnings: string[]
}

export interface SystemServiceDetail {
  summary: SystemServiceSummary
  main_pid: number
  control_pid: number
  result?: string
  exec_main_code?: string
  exec_main_status: number
  restart_count: number
  can_start: boolean
  can_stop: boolean
  can_reload: boolean
  refuse_manual_start: boolean
  refuse_manual_stop: boolean
  fragment_path?: string
  drop_in_paths: string[]
  user?: string
  group?: string
  working_directory?: string
  exec_start?: string
  restart_policy?: string
  type?: string
  active_duration_seconds: number
  memory_current_bytes?: number
  tasks_current?: number
  cpu_usage_nanoseconds?: number
  warnings: string[]
  collected_at: string
}

export interface SystemServiceLogQuery {
  limit?: number
  priority?: string
  boot?: 'current' | 'all'
  after_cursor?: string
}

export interface SystemServiceLogEntry {
  cursor?: string
  timestamp: string
  priority: number
  message: string
  pid?: number
  command?: string
}

export interface SystemServiceLogsResult {
  entries: SystemServiceLogEntry[]
  cursor?: string
  collected_at: string
  warnings: string[]
}

export interface SystemServiceActionRequest {
  action: SystemServiceAction
}

export interface SystemServiceOperation {
  id: string
  revision: number
  session_id: string
  unit_id: string
  action: SystemServiceAction
  phase: SystemServiceOperationPhase
  message: string
  error_code?: string
  state?: SystemServiceSummary
  started_at: string
  updated_at: string
  completed_at?: string
}

export type DockerCapabilityStatus = 'available' | 'missing_cli' | 'daemon_unavailable' | 'permission_denied' | 'unknown'

export type DockerContainerState = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | string

export type DockerHealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'none' | string

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export interface DockerCapability {
  available: boolean
  status: DockerCapabilityStatus
  message?: string
  docker_version?: string
  server_version?: string
  context?: string
  warnings?: string[]
  collected_at: string
}

export interface DockerContainerQuery {
  query?: string
  state?: string
  health?: string
  port?: number
  limit?: number
}

export interface DockerContainerPort {
  ip?: string
  public_port?: number
  private_port?: number
  type?: string
  raw?: string
}

export interface DockerContainerStats {
  id?: string
  name?: string
  cpu_percent?: string
  memory?: string
  memory_percent?: string
  net_io?: string
  block_io?: string
  pids?: string
}

export interface DockerContainerSummary {
  id: string
  short_id: string
  name: string
  image: string
  command?: string
  created_at?: string
  running_for?: string
  ports?: DockerContainerPort[]
  raw_ports?: string
  state: DockerContainerState
  status?: string
  health?: DockerHealthStatus
  compose_project?: string
  stats?: DockerContainerStats
  warnings?: string[]
}

export interface DockerContainerMount {
  type?: string
  source?: string
  destination?: string
  mode?: string
  rw: boolean
}

export interface DockerContainerNetwork {
  name: string
  ip_address?: string
  mac_address?: string
  gateway?: string
}

export interface DockerEnvVar {
  key: string
  value?: string
  redacted?: boolean
}

export interface DockerContainerDetail {
  summary: DockerContainerSummary
  mounts?: DockerContainerMount[]
  networks?: DockerContainerNetwork[]
  labels?: Record<string, string>
  env?: DockerEnvVar[]
  restart_policy?: string
  created?: string
  path?: string
  args?: string[]
  stats?: DockerContainerStats
  logs_preview?: string[]
  collected_at: string
  warnings?: string[]
}

export interface DockerListResult {
  items: DockerContainerSummary[]
  total: number
  filtered: number
  collected_at: string
  warnings?: string[]
}

export interface DockerLogsResult {
  lines: string[]
  tail: number
  timestamps: boolean
  collected_at: string
}

export interface DockerActionRequest {
  action: DockerAction
  timeout_seconds?: number
}

export interface DockerActionResult {
  id?: string
  action: DockerAction
  attempted: boolean
  message: string
  completed_at: string
}

export type AliasBridgeStatus = 'missing' | 'installed'
export type AliasApplyStatus = 'applied' | 'next_prompt' | 'reconnect_required'

export interface ShellAlias {
  id: string
  name: string
  command: string
  description?: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ShellAliasInput {
  name: string
  command: string
  description: string
  enabled: boolean
}

export type ShellAliasPatch = Partial<ShellAliasInput>

export interface AliasWorkspace {
  shell: 'bash' | 'zsh' | 'fish'
  bridge_status: AliasBridgeStatus
  items: ShellAlias[]
}

export interface AliasMutationResult {
  workspace: AliasWorkspace
  alias?: ShellAlias
  apply_status: AliasApplyStatus
}

export type AliasSyncTaskStatus =
  | 'queued'
  | 'loading_source'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'
export type AliasSyncTargetStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'uncertain'
export type AliasSyncTargetPhase =
  | 'resolving'
  | 'connecting'
  | 'waiting_host_trust'
  | 'reading'
  | 'merging'
  | 'committing'
export type AliasSyncSkipReason = 'no_changes' | 'shell_mismatch'

export interface AliasSyncTaskInput {
  alias_ids: string[]
  target_host_ids: string[]
}

export interface AliasSyncTaskSource {
  session_id: string
  host_id?: string
  host_name?: string
  address?: string
  port?: number
  username?: string
  shell?: 'bash' | 'zsh' | 'fish'
}

export interface AliasSyncTarget {
  id: string
  host_id: string
  host_name?: string
  address?: string
  port?: number
  username?: string
  index: number
  status: AliasSyncTargetStatus
  phase?: AliasSyncTargetPhase
  phase_message?: string
  detected_shell?: 'bash' | 'zsh' | 'fish'
  added_count: number
  added_names: string[]
  skipped_count: number
  skipped_names: string[]
  skip_reason?: AliasSyncSkipReason
  apply_status?: AliasApplyStatus
  error_code?: string
  error_message?: string
  started_at?: string
  finished_at?: string
}

export interface AliasSyncTask {
  id: string
  revision: number
  status: AliasSyncTaskStatus
  status_message?: string
  source: AliasSyncTaskSource
  alias_ids: string[]
  target_host_ids: string[]
  targets: AliasSyncTarget[]
  current_target_index?: number
  total_targets: number
  completed_targets: number
  succeeded_targets: number
  skipped_targets: number
  failed_targets: number
  cancelled_targets: number
  uncertain_targets: number
  progress_percent: number
  cancellable: boolean
  created_at: string
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export interface AliasSyncTaskEvent {
  type: 'alias_sync_task_update'
  task: AliasSyncTask
}

export interface Session {
  id: string
  kind: SessionKind
  host_id?: string
  jump_host_id?: string
  proxy_id?: string
  status: SessionStatus
  status_message?: string
  phase?: SessionPhase
  progress?: number
  host_key_challenge_id?: string
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

export interface AppData {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
  sessions: Session[]
  fileSessions: FileSession[]
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
  snippetGroups: CodeSnippetGroup[]
  snippets: CodeSnippet[]
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  localPathMappings: LocalPathMapping[]
  settings: Settings
  terminalFonts: TerminalFont[]
  hostReachability: Record<string, HostReachability>
}
