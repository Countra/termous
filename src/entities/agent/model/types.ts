export const agentApiModes = ['responses', 'chat_completions'] as const
export type AgentApiMode = (typeof agentApiModes)[number]

export const agentReasoningLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AgentReasoningLevel = (typeof agentReasoningLevels)[number]

export const agentReadinessStates = ['ready', 'needs_setup', 'needs_repair', 'blocked'] as const
export type AgentReadinessState = (typeof agentReadinessStates)[number]

export const agentReadinessComponentStates = ['ready', 'missing', 'outdated', 'unavailable'] as const
export type AgentReadinessComponentState = (typeof agentReadinessComponentStates)[number]

export interface AgentSettings {
  default_model_id?: string
  default_reasoning_level: AgentReasoningLevel
  global_context_window_tokens: number
  global_max_output_tokens: number
  show_turn_token_usage: boolean
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentReadinessComponent {
  status: AgentReadinessComponentState
  message: string
}

export interface AgentMcpPolicy {
  client_id: string
  approval_bypass: boolean
  scope_count: number
  required_scope_count: number
  scope_sync_required: boolean
  revision: number
}

export interface AgentReadiness {
  status: AgentReadinessState
  mcp_runtime: AgentReadinessComponent
  mcp_client: AgentReadinessComponent
  skills_bundle: AgentReadinessComponent
  default_model: AgentReadinessComponent
  mcp_policy?: AgentMcpPolicy
  settings: AgentSettings
}

export const agentModelRefreshStatuses = ['never', 'ready', 'stale', 'failed'] as const
export type AgentModelRefreshStatus = (typeof agentModelRefreshStatuses)[number]
export const agentModelAvailabilities = ['available', 'missing'] as const
export type AgentModelAvailability = (typeof agentModelAvailabilities)[number]
export const agentModelSources = ['sync', 'manual'] as const
export type AgentModelSource = (typeof agentModelSources)[number]
export const agentModelParameterModes = ['inherit_global', 'custom'] as const
export type AgentModelParameterMode = (typeof agentModelParameterModes)[number]
export const agentModelReasoningControls = ['none', 'openai_effort'] as const
export type AgentModelReasoningControl = (typeof agentModelReasoningControls)[number]
export const agentModelListStates = ['active', 'removed', 'all'] as const
export type AgentModelListState = (typeof agentModelListStates)[number]

export interface AgentModelProvider {
  id: string
  name: string
  api_mode: AgentApiMode
  base_url: string
  enabled: boolean
  api_key_configured: boolean
  refresh_status: AgentModelRefreshStatus
  last_refresh_attempt_at?: string
  last_refresh_success_at?: string
  last_refresh_error_code?: string
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentModelProviderPage {
  items: AgentModelProvider[]
  next_cursor?: string
}

export interface AgentModelProviderInput {
  name: string
  api_mode: AgentApiMode
  base_url: string
  enabled: boolean
  confirm_insecure_http: boolean
  api_key?: string
  remove_api_key?: boolean
}

export interface AgentModelProviderUpdateInput extends AgentModelProviderInput {
  expected_revision: number
}

export interface AgentModel {
  id: string
  provider_id: string
  remote_model_id: string
  display_name: string
  owned_by?: string
  availability: AgentModelAvailability
  source: AgentModelSource
  parameter_mode: AgentModelParameterMode
  context_window_tokens: number
  max_output_tokens: number
  default_reasoning_level: AgentReasoningLevel
  reasoning_control: AgentModelReasoningControl
  supported_reasoning_levels: AgentReasoningLevel[]
  supports_images: boolean
  supports_reasoning: boolean
  capabilities_confirmed: boolean
  removed_at?: string
  effective_context_window_tokens: number
  effective_max_output_tokens: number
  effective_default_reasoning_level: AgentReasoningLevel
  first_seen_at: string
  last_seen_at: string
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentModelPage {
  items: AgentModel[]
  next_cursor?: string
}

export interface AgentModelListQuery {
  provider_id?: string
  state?: AgentModelListState
  source?: AgentModelSource
}

export interface AgentModelCreateInput {
  remote_model_id: string
  display_name: string
  parameter_mode: AgentModelParameterMode
  context_window_tokens: number
  max_output_tokens: number
  default_reasoning_level: AgentReasoningLevel
  supports_images: boolean
  reasoning_control: AgentModelReasoningControl
  supported_reasoning_levels: AgentReasoningLevel[]
  capabilities_confirmed: true
  expected_revision: number
}

export interface AgentModelCreateResult {
  model: AgentModel
  provider_revision: number
}

export interface AgentModelUpdateInput {
  display_name: string
  parameter_mode: AgentModelParameterMode
  context_window_tokens: number
  max_output_tokens: number
  default_reasoning_level: AgentReasoningLevel
  supports_images: boolean
  reasoning_control: AgentModelReasoningControl
  supported_reasoning_levels: AgentReasoningLevel[]
  capabilities_confirmed: true
  expected_revision: number
}

export interface AgentModelTestResult {
  status: 'ready' | 'failed'
  latency_ms: number
  model_id: string
  message: string
}

export interface AgentProviderTestResult {
  status: 'ready' | 'failed'
  latency_ms: number
  model_count: number
  message: string
}

export const agentRunStatuses = [
  'queued',
  'starting',
  'running',
  'waiting_approval',
  'stopping',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const
export type AgentRunStatus = (typeof agentRunStatuses)[number]

export const agentMessageRoles = ['user', 'assistant'] as const
export type AgentMessageRole = (typeof agentMessageRoles)[number]

export const agentMessageStatuses = ['pending', 'streaming', 'completed', 'failed', 'interrupted'] as const
export type AgentMessageStatus = (typeof agentMessageStatuses)[number]

export const agentMessagePartKinds = ['text', 'reasoning', 'tool_call', 'tool_result'] as const
export type AgentMessagePartKind = (typeof agentMessagePartKinds)[number]

export const agentAttachmentStates = ['ready', 'reserved', 'bound'] as const
export type AgentAttachmentState = (typeof agentAttachmentStates)[number]

export interface AgentAttachment {
  id: string
  session_id: string
  original_name: string
  mime_type: string
  kind: 'text' | 'image'
  size_bytes: number
  state: AgentAttachmentState
  expires_at?: string
  revision: number
  created_at: string
  updated_at: string
}

export const agentSourceContextKinds = ['workbench', 'files', 'host_profile', 'forward_failure'] as const
export type AgentSourceContextKind = (typeof agentSourceContextKinds)[number]

export interface AgentSourceContext {
  kind: AgentSourceContextKind
  entity_id: string
  title: string
  summary: string
}

export const agentResourceKinds = ['ssh_session'] as const
export type AgentResourceKind = (typeof agentResourceKinds)[number]

export interface AgentResourceReference {
  kind: AgentResourceKind
  session_id: string
}

export interface AgentResourceBinding extends AgentResourceReference {
  host_id: string
  ssh_profile_id: string
  host_name: string
  platform: 'linux'
  bound_at: string
}

export interface AgentSSHResourceState {
  session_id: string
  host_id: string
  ssh_profile_id: string
  host_name: string
  ssh_profile_name: string
  status: 'ready' | 'unavailable'
  started_at: string
}

export type AgentLaunchIntent = {
  key: number
  source_context: AgentSourceContext
} & (
  | {
      source: 'workbench'
      host_id: string
      ssh_profile_id: string
      connection_status: string
      resource_reference: AgentResourceReference
    }
  | {
      source: 'files'
      host_id: string
      file_access_profile_id?: string
      connection_status: string
    }
  | {
      source: 'host_profile'
      host_id: string
      profile_kind?: 'ssh' | 'file' | 'remote_desktop'
      profile_id?: string
    }
  | {
      source: 'forward_failure'
      host_id?: string
      forward_id: string
      forward_profile_id?: string
      status: string
      error_code?: string
    }
)

export type AgentLaunchRequest = AgentLaunchIntent extends infer Intent
  ? Intent extends { key: number }
    ? Omit<Intent, 'key'>
    : never
  : never

export type AgentJsonValue =
  | null
  | boolean
  | number
  | string
  | AgentJsonValue[]
  | { [key: string]: AgentJsonValue }

export interface AgentSession {
  id: string
  title: string
  model_id: string
  reasoning_level: AgentReasoningLevel
  archived_at?: string
  revision: number
  created_at: string
  updated_at: string
  resource_binding?: AgentResourceBinding
}

export interface AgentSessionPage {
  items: AgentSession[]
  next_cursor?: string
}

export interface AgentSessionInput {
  title: string
  model_id: string
  reasoning_level: AgentReasoningLevel
  resource_reference?: AgentResourceReference
}

export interface AgentSessionUpdateInput {
  title: string
  model_id: string
  reasoning_level: AgentReasoningLevel
  archived: boolean
  expected_revision: number
}

export interface AgentResourceBindingUpdateInput extends AgentResourceReference {
  expected_revision: number
}

export interface AgentToolCallPart {
  tool_call_id: string
  tool_name: string
  arguments: AgentJsonValue
}

export interface AgentToolResultPart {
  tool_call_id: string
  tool_name: string
  content: AgentJsonValue
  is_error: boolean
}

export type AgentMessagePart = {
  id: string
  message_id: string
  sequence: number
  revision: number
  created_at: string
  updated_at: string
} & (
  | { kind: 'text'; text: string; source_context?: AgentSourceContext }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool_call'; tool_call: AgentToolCallPart }
  | { kind: 'tool_result'; tool_result: AgentToolResultPart }
)

export interface AgentMessage {
  id: string
  session_id: string
  role: AgentMessageRole
  status: AgentMessageStatus
  sequence: number
  revision: number
  created_at: string
  updated_at: string
  parts: AgentMessagePart[]
  attachments: AgentAttachment[]
  turn_usage?: AgentMessageTurnUsage
}

export interface AgentMessageTurnUsage {
  run_id: string
  usage: AgentUsage
  error_code?: string
}

export interface AgentMessagePage {
  items: AgentMessage[]
  next_after_sequence?: number
}

export interface AgentContextCheckpoint {
  boundary_message_sequence: number
  estimated_tokens: number
  created_at: string
}

export interface AgentSessionContext {
  session_id: string
  estimated_tokens: number
  context_window_tokens: number
  estimated: boolean
  warning: boolean
  compression_available: boolean
  checkpoint?: AgentContextCheckpoint
}

export interface AgentUsage {
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated: boolean
}

export const agentQueuedTurnStates = ['queued', 'dispatched', 'cancelled'] as const
export type AgentQueuedTurnState = (typeof agentQueuedTurnStates)[number]

export interface AgentQueuedTurn {
  id: string
  session_id: string
  client_request_id: string
  queue_sequence: number
  prompt: string
  source_context?: AgentSourceContext
  model_id: string
  reasoning_level: AgentReasoningLevel
  force_context_compression: boolean
  state: AgentQueuedTurnState
  editing: boolean
  interrupt_target_run_id?: string
  dispatched_run_id?: string
  error_code?: string
  error_message?: string
  revision: number
  created_at: string
  updated_at: string
  attachments: AgentAttachment[]
}

export interface AgentQueuedTurnPage {
  items: AgentQueuedTurn[]
  queue_state?: AgentQueueState
  next_cursor?: string
}

export type AgentQueuedTurnMovePlacement = 'before' | 'after'

export interface AgentQueuedTurnOrderChange {
  id: string
  queue_sequence: number
  revision: number
  updated_at: string
}

export interface AgentQueuedTurnMoveResult {
  items: AgentQueuedTurnOrderChange[]
}

export interface AgentQueueState {
  session_id: string
  state: 'running' | 'paused'
  pause_reason?: string
  paused_by_run_id?: string
  revision: number
}

export interface AgentSessionUsage extends AgentUsage {
  session_id: string
  run_count: number
  updated_at?: string
}

export interface AgentRunModelSnapshot {
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  provider_id: string
  provider_name: string
  model_display_name: string
  provider_revision: number
  model_revision: number
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  reasoning_control: AgentModelReasoningControl
  supported_reasoning_levels: AgentReasoningLevel[]
  supports_reasoning: boolean
}

export interface AgentRun {
  id: string
  client_request_id: string
  session_id: string
  generation: number
  event_sequence: number
  status: AgentRunStatus
  user_message_id: string
  assistant_message_id: string
  provider_id: string
  model_id: string
  model_snapshot: AgentRunModelSnapshot
  reasoning_level: AgentReasoningLevel
  usage: AgentUsage
  error_code?: string
  error_message?: string
  revision: number
  queued_at: string
  started_at?: string
  completed_at?: string
  updated_at: string
}

export const agentRunEventKinds = [
  'status',
  'message_delta',
  'message_part',
  'tool_started',
  'tool_completed',
  'tool_failed',
  'approval_waiting',
  'approval_resolved',
  'steer',
  'usage',
  'error',
] as const
export type AgentRunEventKind = (typeof agentRunEventKinds)[number]

export interface AgentToolEventData {
  tool_call_id: string
  tool_name: string
  arguments?: AgentJsonValue
  result?: AgentJsonValue
  duration_ms?: number
  error_code?: string
}

interface AgentRunEventBase<Kind extends AgentRunEventKind, Payload> {
  id: string
  run_id: string
  generation: number
  sequence: number
  kind: Kind
  payload: Payload
  created_at: string
}

export type AgentRunEvent =
  | AgentRunEventBase<'status', { status: { status: AgentRunStatus } }>
  | AgentRunEventBase<'message_delta', {
      message_delta: {
        message_id: string
        part_id: string
        kind: 'text' | 'reasoning'
        delta: string
      }
    }>
  | AgentRunEventBase<'message_part', { message_part: AgentMessagePart }>
  | AgentRunEventBase<'tool_started' | 'tool_completed' | 'tool_failed', {
      tool: AgentToolEventData
    }>
  | AgentRunEventBase<'approval_waiting' | 'approval_resolved', {
      approval: { approval_id: string; decision?: string }
    }>
  | AgentRunEventBase<'steer', {
      steer: { client_request_id: string; message_id: string; part_id: string }
    }>
  | AgentRunEventBase<'usage', { usage: AgentUsage }>
  | AgentRunEventBase<'error', { error: { code: string; message: string } }>

export interface AgentRunEventPage {
  items: AgentRunEvent[]
  next_after_sequence?: number
}

export function isAgentRunTerminal(status: AgentRunStatus) {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
}

export function isAgentRunActive(status: AgentRunStatus) {
  return !isAgentRunTerminal(status)
}
