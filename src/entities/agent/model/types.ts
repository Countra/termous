export const agentApiModes = ['responses', 'chat_completions'] as const
export type AgentApiMode = (typeof agentApiModes)[number]

export const agentReasoningLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type AgentReasoningLevel = (typeof agentReasoningLevels)[number]

export const agentReadinessStates = ['ready', 'needs_setup', 'needs_repair', 'blocked'] as const
export type AgentReadinessState = (typeof agentReadinessStates)[number]

export const agentReadinessComponentStates = ['ready', 'missing', 'outdated', 'unavailable'] as const
export type AgentReadinessComponentState = (typeof agentReadinessComponentStates)[number]

export interface AgentSettings {
  default_model_profile_id?: string
  default_reasoning_level: AgentReasoningLevel
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

export interface AgentModelProfile {
  id: string
  name: string
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  supports_reasoning: boolean
  api_key_configured: boolean
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentModelProfilePage {
  items: AgentModelProfile[]
  next_cursor?: string
}

export interface AgentModelProfileInput {
  name: string
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  supports_reasoning: boolean
  confirm_insecure_http: boolean
}

export interface AgentModelProfileUpdateInput extends AgentModelProfileInput {
  expected_revision: number
}

export interface AgentModelTestResult {
  status: 'ready' | 'failed'
  latency_ms: number
  model_id: string
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
  model_profile_id: string
  reasoning_level: AgentReasoningLevel
  archived_at?: string
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentSessionPage {
  items: AgentSession[]
  next_cursor?: string
}

export interface AgentSessionInput {
  title: string
  model_profile_id: string
  reasoning_level: AgentReasoningLevel
}

export interface AgentSessionUpdateInput extends AgentSessionInput {
  archived: boolean
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
  | { kind: 'text'; text: string }
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
}

export interface AgentMessagePage {
  items: AgentMessage[]
  next_after_sequence?: number
}

export interface AgentUsage {
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated: boolean
}

export interface AgentRunModelSnapshot {
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
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
  model_profile_id: string
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
