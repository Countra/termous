export type SessionStatus =
  | 'connecting'
  | 'waiting_host_trust'
  | 'connected'
  | 'disconnected'
  | 'failed'

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
