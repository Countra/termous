import type { AgentSession, AgentSSHSlotResourceBinding } from './types.ts'

export const agentResourceConnectionStatuses = [
  'connecting',
  'waiting_host_trust',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type AgentResourceConnectionStatus = (typeof agentResourceConnectionStatuses)[number]

export interface AgentResourceConnectionInput {
  kind: 'ssh_session'
  ssh_profile_id: string
  expected_revision: number
  expected_instance_id: string
  client_request_id: string
}

export interface AgentResourceConnectionTarget {
  host_id: string
  host_name: string
  ssh_profile_id: string
  profile_name: string
  platform: 'linux'
}

export interface AgentResourceConnectionOperation {
  id: string
  instance_id: string
  session_id: string
  kind: 'ssh_session'
  client_request_id: string
  revision: number
  status: AgentResourceConnectionStatus
  target: AgentResourceConnectionTarget
  source_binding: AgentSSHSlotResourceBinding | null
  phase?: string
  message?: string
  candidate_session_id?: string
  error_code?: string
  retryable: boolean
  created_at: string
  updated_at: string
  result_session?: AgentSession
}

export interface AgentResourceConnectionView {
  instance_id: string
  operation: AgentResourceConnectionOperation | null
}

export function isAgentResourceConnectionActive(
  operation: AgentResourceConnectionOperation | null | undefined,
) {
  return operation?.status === 'connecting'
    || operation?.status === 'waiting_host_trust'
    || operation?.status === 'cancelling'
}
