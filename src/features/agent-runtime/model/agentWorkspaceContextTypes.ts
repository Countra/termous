import type { AgentSessionContext } from '#entities/agent'

export type AgentSessionContextLoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface AgentWorkspaceSessionContextState {
  phase: AgentSessionContextLoadPhase
  value?: AgentSessionContext
  compression_pending: boolean
  error_code?: string
}
