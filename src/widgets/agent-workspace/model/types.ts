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
  model_profile_id: string
  model_name: string
  updated_at: string
  archived: boolean
  run_status: AgentWorkspaceRunStatus
}

export interface AgentWorkspaceModelOption {
  id: string
  name: string
  supports_reasoning: boolean
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
}

export interface AgentWorkspaceContextState {
  used_tokens: number
  context_window_tokens: number
  estimated: boolean
  warning_threshold: number
}

export interface AgentWorkspaceSkillItem {
  name: string
  description: string
}

export interface AgentWorkspaceMcpState {
  connected: boolean
  tool_count?: number
  scope_count: number
  approval_bypass: boolean
}

export interface AgentWorkspaceInspectorState {
  context: AgentWorkspaceContextState
  skills: AgentWorkspaceSkillItem[]
  mcp: AgentWorkspaceMcpState
}

export interface AgentWorkspaceProps {
  sessions: AgentWorkspaceSession[]
  selected_session_id?: string
  messages: AgentWorkspaceMessage[]
  models: AgentWorkspaceModelOption[]
  selected_model_profile_id?: string
  inspector: AgentWorkspaceInspectorState
  draft: string
  loading: boolean
  busy: boolean
  run_blocked: boolean
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onModelChange: (profileId: string) => void
  onDraftChange: (value: string) => void
  onSend: (message: string) => Promise<void>
  onSteer: (message: string) => Promise<void>
  onStop: () => Promise<void>
  onApprovalBypassChange: (enabled: boolean) => Promise<void>
}

export function isActiveAgentRun(status: AgentWorkspaceRunStatus | undefined) {
  return status === 'queued'
    || status === 'starting'
    || status === 'running'
    || status === 'waiting_approval'
    || status === 'stopping'
}
