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
import type {
  CodeSnippet,
  CodeSnippetGroup,
} from '#entities/snippet'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileSession,
  LocalPathMapping,
} from '#entities/file'
import type {
  ForwardInstance,
  ForwardProfile,
} from '#entities/forward'

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
  ForwardEvent,
  ForwardInstance,
  ForwardMode,
  ForwardPhase,
  ForwardProfile,
  ForwardProfileInput,
  ForwardScope,
  ForwardStartRequest,
  ForwardStatus,
} from '#entities/forward'

export type {
  DockerAction,
  DockerActionRequest,
  DockerActionResult,
  DockerCapability,
  DockerCapabilityStatus,
  DockerContainerDetail,
  DockerContainerMount,
  DockerContainerNetwork,
  DockerContainerPort,
  DockerContainerQuery,
  DockerContainerState,
  DockerContainerStats,
  DockerContainerSummary,
  DockerEnvVar,
  DockerHealthStatus,
  DockerListResult,
  DockerLogsResult,
} from '#entities/docker'

export type {
  FirewallApplyResult,
  FirewallCapability,
  FirewallCapabilityStatus,
  FirewallDesiredState,
  FirewallInstallCommand,
  FirewallInstallPlan,
  FirewallPersistenceInstallResult,
  FirewallPersistenceStatus,
  FirewallPersistenceStatusKind,
  FirewallPlan,
  FirewallPlanChange,
  FirewallPortRange,
  FirewallPrivilegeMode,
  FirewallProvider,
  FirewallProviderInfo,
  FirewallProviderList,
  FirewallProviderOption,
  FirewallRule,
  FirewallRuleAction,
  FirewallRuleDirection,
  FirewallRuleFamily,
  FirewallRuleInput,
  FirewallRuleProtocol,
  FirewallSaveResult,
  FirewallSnapshot,
} from '#entities/firewall'

export type {
  LinuxMonitorCPU,
  LinuxMonitorCPUCore,
  LinuxMonitorDisk,
  LinuxMonitorDiskIO,
  LinuxMonitorDiskIODevice,
  LinuxMonitorLoadAverage,
  LinuxMonitorMemory,
  LinuxMonitorNetwork,
  LinuxMonitorSnapshot,
  LinuxMonitorStatus,
  RemoteProcessDetail,
  RemoteProcessListResult,
  RemoteProcessPort,
  RemoteProcessQuery,
  RemoteProcessSort,
  RemoteProcessSummary,
  RemoteProcessTerminateRequest,
  RemoteProcessTerminateResult,
  RemoteProcessTerminateSignal,
} from '#entities/observability'

export type {
  SystemServiceAction,
  SystemServiceActionRequest,
  SystemServiceCapability,
  SystemServiceCapabilityStatus,
  SystemServiceDetail,
  SystemServiceListResult,
  SystemServiceLogEntry,
  SystemServiceLogQuery,
  SystemServiceLogsResult,
  SystemServiceManageMode,
  SystemServiceOperation,
  SystemServiceOperationPhase,
  SystemServiceQuery,
  SystemServiceRuntimeFilter,
  SystemServiceSort,
  SystemServiceSummary,
} from '#entities/service'

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
  CodeSnippet,
  CodeSnippetGroup,
  CodeSnippetGroupInput,
  CodeSnippetInput,
  SnippetShell,
} from '#entities/snippet'

export type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileOperationPhase,
  FileOperationStatus,
  FileOperationTask,
  FileOperationType,
  FileSession,
  FileSessionPhase,
  FileSessionStatus,
  LocalFileGrant,
  LocalGrantItem,
  LocalGrantSource,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  LocalTreeEntry,
  LocalTreeEntryKind,
  OverwritePolicy,
  RemoteDirectoryListing,
  RemoteFileEntry,
  RemoteFileKind,
  RemoteImageFile,
  RemoteTextEncoding,
  RemoteTextFile,
  RemoteTextLineEnding,
  RemoteTextSaveRequest,
  RemoteTextSaveResult,
  SftpExtendedAttribute,
  TransferStatus,
  TransferTask,
  TransferType,
} from '#entities/file'

export type {
  GroupReorderItem,
  PageKey,
} from '#shared/model'

export type Language = AppLanguage

export type ThemeMode = AppTheme

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
