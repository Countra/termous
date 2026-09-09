import type {
  AgentAttachment,
  AgentCompactionActivity,
  AgentRetryActivity,
  AgentResponseFailure,
  AgentContextCompressionStatus,
  AgentContextLastSnapshot,
  AgentContextUsageBasis,
  AgentQueueState,
  AgentQueuedTurn,
  AgentQueuedTurnMovePlacement,
  AgentReasoningLevel,
  AgentResourceBinding,
  AgentResourceReference,
  AgentResourceKind,
  AgentSessionGroup,
  AgentResourceState,
  AgentSourceContext,
  AgentUsage,
} from '#entities/agent'
import type {
  AgentApprovalMode,
  AgentApprovalPolicyState,
} from '#features/agent-approval-policy'

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
  group_id?: string
  pinned?: boolean
  pin_order?: number
  sort_order?: number
  last_activity_at?: string
  model_id: string
  model_name: string
  model_alias?: string
  provider_name?: string
  updated_at: string
  archived: boolean
  run_status: AgentWorkspaceRunStatus
  resource_bindings?: AgentResourceBinding[]
}

export type AgentWorkspaceResourceStatus = 'checking' | 'ready' | 'unavailable' | 'stale'

export interface AgentWorkspaceResourceContext {
  binding: AgentResourceBinding
  status: AgentWorkspaceResourceStatus
  live_resource?: AgentResourceState
  candidates: AgentResourceState[]
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
  | { id: string; kind: 'compaction'; activity: AgentCompactionActivity }
  | { id: string; kind: 'retry'; activity: AgentRetryActivity }
  | { id: string; kind: 'response_failure'; failure: AgentResponseFailure; after_part_sequence: number }

export interface AgentWorkspaceMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'failed' | 'interrupted' | 'interrupted_by_steer'
  created_at: string
  parts: AgentWorkspaceMessagePart[]
  attachments: AgentAttachment[]
  source_context?: AgentSourceContext
  usage?: AgentUsage
  duration_ms?: number
  error_code?: string
  error_message?: string
}

export interface AgentWorkspaceDraftAttachment {
  origin?: AgentAttachment['origin']
  client_id: string
  name: string
  size_bytes: number
  kind: 'text' | 'image'
  file: File
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
  assessment?: 'ready' | 'pending'
  basis?: AgentContextUsageBasis
  compression_status?: AgentContextCompressionStatus
  last_snapshot?: AgentContextLastSnapshot
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
}

export interface AgentWorkspaceInspectorState {
  context: AgentWorkspaceContextState
  usage: AgentWorkspaceUsageState
  skills: AgentWorkspaceSkillItem[]
  mcp: AgentWorkspaceMcpState
}

export interface AgentWorkspaceSessionManagement {
  groups: AgentSessionGroup[]
  pendingIds: ReadonlySet<string>
  disabled: boolean
  searchQuery: string
  searchResults: AgentWorkspaceSession[]
  searchLoading: boolean
  searchError?: string
  onSearchQueryChange: (query: string) => void
  onSearchRetry: () => void
  onRename: (id: string, title: string) => Promise<void>
  onPin: (id: string, pinned: boolean) => Promise<void>
  onMoveToGroup: (id: string, groupId: string | undefined, unpin?: boolean) => Promise<void>
  onCreateGroup: (name: string) => Promise<void>
  onRenameGroup: (id: string, name: string) => Promise<void>
  onDeleteGroup: (id: string) => Promise<void>
  onMoveGroup: (id: string, targetId: string, placement: 'before' | 'after') => Promise<void>
  onMovePin: (id: string, targetId: string, placement: 'before' | 'after') => Promise<void>
  onMoveSession: (id: string, targetId: string, placement: 'before' | 'after') => Promise<void>
  onOpenArchives: () => void
}

export interface AgentWorkspaceProps {
  composerFocusKey?: number
  composerActive?: boolean
  sessions: AgentWorkspaceSession[]
  session_management?: AgentWorkspaceSessionManagement
  selected_session_id?: string
  messages: AgentWorkspaceMessage[]
  models: AgentWorkspaceModelOption[]
  selected_model_id?: string
  default_model_id?: string
  selected_reasoning_level: AgentReasoningLevel
  approval_policy: AgentApprovalPolicyState
  inspector: AgentWorkspaceInspectorState
  draft: string
  draft_source_context?: AgentSourceContext
  draft_attachments: AgentWorkspaceDraftAttachment[]
  queued_turns: AgentQueuedTurn[]
  queued_turn_counts: Record<string, number>
  queue_state?: AgentQueueState
  queued_turn_edit?: { turn_id: string; text: string; retained_attachment_ids: string[] }
  supports_images: boolean
  model_runnable: boolean
  show_turn_token_usage: boolean
  loading: boolean
  busy: boolean
  queue_busy: boolean
  stop_busy: boolean
  active_run?: {
    session_id: string
    status: AgentWorkspaceRunStatus
  }
  run_blocked: boolean
  resource_run_blocked: boolean
  resource_contexts?: AgentWorkspaceResourceContext[]
  onCreateSession: (groupId?: string) => void
  onSelectSession: (sessionId: string) => void
  onReturnToActiveRun: () => void
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onModelChange: (modelId: string) => void
  onReasoningChange: (reasoningLevel: AgentReasoningLevel) => void
  onResetResponseOptions: () => void
  onOpenSettings: () => void
  onDraftChange: (value: string) => void
  onAttachFiles: (files: File[]) => Promise<void>
  onRemoveAttachment: (clientId: string) => Promise<void>
  onRetryAttachment: (clientId: string) => Promise<void>
  onLoadAttachmentContent: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
  onSend: (message: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => Promise<void>
  onQueueTurn: (message: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => Promise<void>
  onBeginQueuedTurnEdit: (turnId: string) => Promise<void>
  onQueuedTurnEditChange: (value: string) => void
  onRemoveQueuedTurnEditAttachment: (attachmentId: string) => void
  onSaveQueuedTurnEdit: (attachmentIds: string[]) => Promise<void>
  onCancelQueuedTurnEdit: () => Promise<void>
  onDeleteQueuedTurn: (turnId: string) => Promise<void>
  onMoveQueuedTurn: (
    turnId: string,
    targetTurnId: string,
    placement: AgentQueuedTurnMovePlacement,
  ) => Promise<boolean>
  onSteerQueuedTurn: (turnId: string) => Promise<void>
  onResumeQueue: () => Promise<void>
  onStop: () => Promise<void>
  onContextCompressionPendingChange: (enabled: boolean) => void
  onRetryContext: () => void
  onRetryUsage: () => void
  onApprovalModeChange: (mode: AgentApprovalMode) => Promise<void>
  onReplaceResourceBinding: (reference: AgentResourceReference) => Promise<boolean>
  onRemoveResourceBinding: (kind: AgentResourceKind) => Promise<boolean>
}

export function isActiveAgentRun(status: AgentWorkspaceRunStatus | undefined) {
  return status === 'queued'
    || status === 'starting'
    || status === 'running'
    || status === 'waiting_approval'
    || status === 'stopping'
}
