export const agentRuntimeProtocolVersion = '3' as const

export type AgentSkillsBundleState =
  | 'ready'
  | 'missing'
  | 'outdated'
  | 'unavailable'

export interface AgentSkillsBundleStatus {
  status: AgentSkillsBundleState
  fingerprint: string
  skill_count: number
  resource_count: number
  error_category?: string
}

export type AgentRuntimeState =
  | 'offline'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'

export interface AgentRuntimeStatus {
  state: AgentRuntimeState
  active_run_id?: string
  generation?: number
  error_code?: string
}

export interface AgentRuntimeRunRef {
  run_id: string
  generation: number
}

export interface AgentRuntimeSteerRequest extends AgentRuntimeRunRef {
  message: string
}

export interface AgentRuntimeCommandResult {
  accepted: boolean
  status: AgentRuntimeStatus
  error_code?: string
}
