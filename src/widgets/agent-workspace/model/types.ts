import type {
  AgentAttachment,
  AgentReasoningLevel,
  AgentSourceContext,
  AgentUsage,
} from '#entities/agent'

export type AgentWorkspaceRunStatus =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface AgentWorkspaceSession {
  id: string
  title: string
  model_id: string
  model_name: string
  model_alias?: string
  provider_name?: string
  updated_at: string
  archived: boolean
  run_status: AgentWorkspaceRunStatus
}

export type AgentWorkspaceModelUnavailableReason =
  | 'removed'
  | 'provider_disabled'
  | 'catalog_stale'
  | 'missing'

export interface AgentWorkspaceModelOption {
  id: string
  display_name: string
  provider_id: string
  provider_name: string
  remote_model_id: string
  source: 'sync' | 'manual'
  supports_images: boolean
  reasoning_control: 'none' | 'openai_effort'
  supported_reasoning_levels: AgentReasoningLevel[]
  effective_default_reasoning_level: AgentReasoningLevel
  effective_context_window_tokens: number
  effective_max_output_tokens: number
  runnable: boolean
  unavailable_reason?: AgentWorkspaceModelUnavailableReason
}

export interface AgentWorkspaceTextPart {
  id: string
  kind: 'text'
  text: string
}

export interface AgentWorkspaceReasoningPart {
  id: string
  kind: 'reasoning'
  text: string
  streaming: boolean
}

export interface AgentWorkspaceToolPart {
  id: string
  kind: 'tool'
  name: string
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'interrupted'
  duration_ms?: number
  summary?: string
  detail?: string
}

export type AgentWorkspaceMessagePart =
  | AgentWorkspaceTextPart
  | AgentWorkspaceReasoningPart
  | AgentWorkspaceToolPart

export interface AgentWorkspaceMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'failed' | 'interrupted'
  created_at: string
  parts: AgentWorkspaceMessagePart[]
  attachments: AgentAttachment[]
  source_context?: AgentSourceContext
  usage?: AgentUsage
}

export interface AgentWorkspaceDraftAttachment {
  client_id: string
  name: string
  size_bytes: number
  kind: 'text' | 'image'
  phase: 'uploading' | 'ready' | 'failed' | 'deleting'
  attachment?: AgentAttachment
  error_code?: string
}

export interface AgentWorkspaceContextState {
  phase: 'unavailable' | 'idle' | 'loading' | 'ready' | 'error'
  has_snapshot: boolean
  used_tokens: number
  context_window_tokens: number
  estimated: boolean
  warning: boolean
  compression_available: boolean
  compression_pending: boolean
  checkpoint?: {
    estimated_tokens: number
    created_at: string
  }
  error_code?: string
}

export interface AgentWorkspaceUsageState {
  phase: 'unavailable' | 'idle' | 'loading' | 'ready' | 'error'
  has_snapshot: boolean
  run_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated: boolean
  updated_at?: string
  error_code?: string
}

export interface AgentWorkspaceSkillItem {
  name: string
  description: string
}

export interface AgentWorkspaceMcpState {
  connection: 'connected' | 'connecting' | 'on_demand' | 'disconnected'
  tool_count?: number
  scope_count: number
  approval_bypass: boolean
}

export interface AgentWorkspaceInspectorState {
  context: AgentWorkspaceContextState
  usage: AgentWorkspaceUsageState
  skills: AgentWorkspaceSkillItem[]
  mcp: AgentWorkspaceMcpState
}

export interface AgentWorkspaceProps {
  sessions: AgentWorkspaceSession[]
  selected_session_id?: string
  messages: AgentWorkspaceMessage[]
  models: AgentWorkspaceModelOption[]
  selected_model_id?: string
  selected_reasoning_level: AgentReasoningLevel
  inspector: AgentWorkspaceInspectorState
  draft: string
  draft_source_context?: AgentSourceContext
  draft_attachments: AgentWorkspaceDraftAttachment[]
  supports_images: boolean
  model_runnable: boolean
  show_turn_token_usage: boolean
  loading: boolean
  busy: boolean
  active_run?: {
    session_id: string
    status: AgentWorkspaceRunStatus
  }
  run_blocked: boolean
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  onReturnToActiveRun: () => void
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onModelChange: (modelId: string) => void
  onReasoningChange: (reasoningLevel: AgentReasoningLevel) => void
  onOpenSettings: () => void
  onDraftChange: (value: string) => void
  onAttachFiles: (files: File[]) => Promise<void>
  onRemoveAttachment: (clientId: string) => Promise<void>
  onRetryAttachment: (clientId: string) => Promise<void>
  onLoadAttachmentContent: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
  onSend: (message: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => Promise<void>
  onSteer: (message: string) => Promise<void>
  onStop: () => Promise<void>
  onContextCompressionPendingChange: (enabled: boolean) => void
  onRetryContext: () => void
  onRetryUsage: () => void
  onApprovalBypassChange: (enabled: boolean) => Promise<void>
}

export function isActiveAgentRun(status: AgentWorkspaceRunStatus | undefined) {
  return status === 'queued'
    || status === 'starting'
    || status === 'running'
    || status === 'waiting_approval'
    || status === 'stopping'
}
