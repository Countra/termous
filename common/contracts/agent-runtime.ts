export const agentRuntimeProtocolVersion = '13' as const

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

export type AgentRuntimeState = 'offline' | 'ready'

export interface AgentRuntimeWorkerStatus {
  state: 'starting' | 'running' | 'stopping'
  run_id: string
  generation: number
  session_id: string
  error_code?: string
}

export interface AgentRuntimeStatus {
  state: AgentRuntimeState
  capacity?: number
  occupied_slots?: number
  workers?: AgentRuntimeWorkerStatus[]
  error_code?: string
}

export interface AgentRuntimeRunRef {
  run_id: string
  generation: number
}

export interface AgentRuntimeSteerRequest extends AgentRuntimeRunRef {
  message: string
}

export interface AgentQueuedTurnSteerRequest extends AgentRuntimeRunRef {
  queued_turn_id: string
  expected_revision: number
  expected_run_revision: number
}

export interface AgentRuntimeCommandResult {
  accepted: boolean
  status: AgentRuntimeStatus
  error_code?: string
}
