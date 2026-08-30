import type { AgentSessionUsage } from '#entities/agent'

export type AgentSessionUsageLoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface AgentWorkspaceSessionUsageState {
  phase: AgentSessionUsageLoadPhase
  value?: AgentSessionUsage
  error_code?: string
}
