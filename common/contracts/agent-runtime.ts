export const agentRuntimeProtocolVersion = '1' as const

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

