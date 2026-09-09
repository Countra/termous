import type { AgentLaunchIntent, AgentResourceBinding, AgentSSHResourceState } from './types.ts'

export type AgentTerminalReferenceLaunch = Omit<Extract<AgentLaunchIntent, { source: 'terminal_selection' }>, 'key'>
export type AgentTerminalReferenceTarget = AgentTerminalReferenceLaunch['target']

export interface AgentReferenceTargetSummary {
  session_id: string
  title: string
  pinned?: boolean
  last_activity_at?: string
  resource_bindings?: AgentResourceBinding[]
  binding_locked: boolean
}

export interface AgentReferenceTargetsSnapshot {
  ready: boolean
  targets: AgentReferenceTargetSummary[]
}

export function sameTerminalReferenceSource(
  captured: AgentSSHResourceState,
  current: AgentSSHResourceState | undefined,
): boolean {
  return Boolean(current && current.status === 'ready'
    && current.session_id === captured.session_id
    && current.host_id === captured.host_id
    && current.ssh_profile_id === captured.ssh_profile_id
    && current.started_at === captured.started_at)
}
