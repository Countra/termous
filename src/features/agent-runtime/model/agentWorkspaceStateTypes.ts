import type { AgentMessage, AgentQueueState, AgentQueuedTurn, AgentRun, AgentRunEvent, AgentSession, AgentSessionGroup } from '#entities/agent'
import type { AgentRuntimeStatus } from '#common/contracts'
import type { AgentWorkspaceSessionContextState } from './agentWorkspaceContextTypes.ts'
import type { AgentWorkspaceSessionUsageState } from './agentWorkspaceUsageTypes.ts'

export type AgentWorkspacePhase = 'idle' | 'loading' | 'ready' | 'reconnecting' | 'degraded'

export interface AgentComposerDraft {
  text: string
  updated_at: number
}

export interface AgentQueuedTurnEditDraft {
  turn_id: string
  text: string
  retained_attachment_ids: string[]
}

export interface AgentWorkspaceState {
  phase: AgentWorkspacePhase
  snapshot_complete: boolean
  revision: number
  sessions: AgentSession[]
  session_groups: AgentSessionGroup[]
  runs: Record<string, AgentRun>
  active_run_id?: string
  messages: Record<string, AgentMessage[]>
  run_events: Record<string, AgentRunEvent[]>
  run_event_sequences: Record<string, number>
  run_part_overlays: Record<string, Record<string, AgentMessage['parts'][number]>>
  drafts: Record<string, AgentComposerDraft>
  queued_turns: Record<string, AgentQueuedTurn[]>
  queue_states: Record<string, AgentQueueState>
  queued_turn_edits: Record<string, AgentQueuedTurnEditDraft>
  session_contexts: Record<string, AgentWorkspaceSessionContextState>
  session_usages: Record<string, AgentWorkspaceSessionUsageState>
  selected_session_id?: string
  new_session_selected: boolean
  selection_intent_revision: number
  runtime_status?: AgentRuntimeStatus
  error_code?: string
}

export interface AgentWorkspaceMergeResult {
  state: AgentWorkspaceState
  reconcile_run?: { id: string; generation: number }
}
