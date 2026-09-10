import type { AgentSession, AgentSSHResourceBinding } from './types.ts'

export const agentResourceRecoveryStatuses = ['connecting', 'waiting_host_trust', 'cancelling', 'succeeded', 'failed', 'cancelled'] as const
export type AgentResourceRecoveryStatus = (typeof agentResourceRecoveryStatuses)[number]
export const agentResourceRecoveryBlockedReasons = ['no_binding', 'ready', 'archived', 'active_run', 'recovering', 'profile_unavailable', 'mcp_unavailable', 'closing'] as const
export type AgentResourceRecoveryBlockedReason = (typeof agentResourceRecoveryBlockedReasons)[number]

export interface AgentResourceRecoveryInput {
  kind: 'ssh_session'
  expected_revision: number
  client_request_id: string
}

export interface AgentResourceRecoveryOperation {
  id: string
  instance_id: string
  session_id: string
  kind: 'ssh_session'
  client_request_id: string
  revision: number
  status: AgentResourceRecoveryStatus
  source_binding: AgentSSHResourceBinding
  phase?: string
  message?: string
  candidate_session_id?: string
  error_code?: string
  retryable: boolean
  created_at: string
  updated_at: string
  result_session?: AgentSession
}

export interface AgentResourceRecoveryView {
  instance_id: string
  kind: 'ssh_session'
  can_recover: boolean
  blocked_reason?: AgentResourceRecoveryBlockedReason
  operation: AgentResourceRecoveryOperation | null
}

export interface AgentResourceRecoveryState {
  view?: AgentResourceRecoveryView
  checking: boolean
  submitting: boolean
  uncertain: boolean
  error_code?: string
}

export function isAgentResourceRecoveryActive(operation: AgentResourceRecoveryOperation | null | undefined) {
  return operation?.status === 'connecting' || operation?.status === 'waiting_host_trust' || operation?.status === 'cancelling'
}

export function isAgentResourceRecoveryBlocking(state: AgentResourceRecoveryState | undefined) {
  return Boolean(state && (state.submitting || state.uncertain || isAgentResourceRecoveryActive(state.view?.operation)))
}
