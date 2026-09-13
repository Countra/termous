export const agentSlashCommandIds = ['session', 'profile', 'compact'] as const
export type AgentSlashCommandId = (typeof agentSlashCommandIds)[number]

export const agentSlashResourceKinds = ['ssh', 'file'] as const
export type AgentSlashResourceKind = (typeof agentSlashResourceKinds)[number]

export const agentSlashCandidateKinds = [
  'ssh_session',
  'file_session',
  'ssh_profile',
  'file_profile',
] as const
export type AgentSlashCandidateKind = (typeof agentSlashCandidateKinds)[number]

export const agentSlashCandidateDisabledReasons = [
  'session_not_ready',
  'host_missing',
  'profile_missing',
  'profile_invalid',
  'ssh_profile_missing',
  'profile_host_mismatch',
  'unsupported_engine',
  'unsupported_platform',
] as const
export type AgentSlashCandidateDisabledReason = (typeof agentSlashCandidateDisabledReasons)[number]

export type AgentSlashSSHSessionStatus =
  | 'ready'
  | 'connecting'
  | 'waiting_host_trust'
  | 'disconnected'
  | 'failed'

export type AgentSlashFileSessionStatus =
  | 'connected'
  | 'connecting'
  | 'waiting_host_trust'
  | 'disconnected'
  | 'failed'

export type AgentSlashProfileStatus = 'ready' | 'unavailable'

interface AgentSlashCandidateBase {
  id: string
  kind: AgentSlashCandidateKind
  resource_kind: AgentSlashResourceKind
  host_id: string
  host_name: string
  profile_id: string
  profile_name: string
  current: boolean
  disabled_reason?: AgentSlashCandidateDisabledReason
}

export interface AgentSlashSSHSessionCandidate extends AgentSlashCandidateBase {
  kind: 'ssh_session'
  resource_kind: 'ssh'
  session_id: string
  ssh_profile_id: string
  started_at: string
  status: AgentSlashSSHSessionStatus
}

export interface AgentSlashFileSessionCandidate extends AgentSlashCandidateBase {
  kind: 'file_session'
  resource_kind: 'file'
  file_access_profile_id: string
  representative_session_id: string
  session_count: number
  status: AgentSlashFileSessionStatus
}

export interface AgentSlashSSHProfileCandidate extends AgentSlashCandidateBase {
  kind: 'ssh_profile'
  resource_kind: 'ssh'
  ssh_profile_id: string
  sort_order: number
  status: AgentSlashProfileStatus
}

export interface AgentSlashFileProfileCandidate extends AgentSlashCandidateBase {
  kind: 'file_profile'
  resource_kind: 'file'
  file_access_profile_id: string
  sort_order: number
  status: AgentSlashProfileStatus
}

export type AgentSlashSessionCandidate = AgentSlashSSHSessionCandidate | AgentSlashFileSessionCandidate
export type AgentSlashProfileCandidate = AgentSlashSSHProfileCandidate | AgentSlashFileProfileCandidate
export type AgentSlashCandidate = AgentSlashSessionCandidate | AgentSlashProfileCandidate

export interface AgentSlashCandidateCatalog {
  session: {
    ssh: AgentSlashSSHSessionCandidate[]
    file: AgentSlashFileSessionCandidate[]
  }
  profile: {
    ssh: AgentSlashSSHProfileCandidate[]
    file: AgentSlashFileProfileCandidate[]
  }
}
