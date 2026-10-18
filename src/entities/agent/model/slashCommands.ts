export const agentSlashCommandIds = ['session', 'profile', 'workflow', 'compact'] as const
export type AgentSlashCommandId = (typeof agentSlashCommandIds)[number]

export const agentSlashResourceKinds = ['ssh', 'file', 'desktop', 'workflow'] as const
export type AgentSlashResourceKind = (typeof agentSlashResourceKinds)[number]

export const agentSlashCandidateKinds = [
  'ssh_session',
  'file_session',
  'ssh_profile',
  'file_profile',
  'desktop_session',
  'desktop_profile',
  'desktop_workflow',
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
  current: boolean
  disabled_reason?: AgentSlashCandidateDisabledReason
}

interface AgentSlashConnectionCandidateBase extends AgentSlashCandidateBase {
  host_id: string
  host_name: string
  profile_id: string
  profile_name: string
}

export interface AgentSlashSSHSessionCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'ssh_session'
  resource_kind: 'ssh'
  session_id: string
  ssh_profile_id: string
  started_at: string
  status: AgentSlashSSHSessionStatus
}

export interface AgentSlashFileSessionCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'file_session'
  resource_kind: 'file'
  file_access_profile_id: string
  representative_session_id: string
  session_count: number
  status: AgentSlashFileSessionStatus
}

export interface AgentSlashSSHProfileCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'ssh_profile'
  resource_kind: 'ssh'
  ssh_profile_id: string
  sort_order: number
  status: AgentSlashProfileStatus
}

export interface AgentSlashFileProfileCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'file_profile'
  resource_kind: 'file'
  file_access_profile_id: string
  sort_order: number
  status: AgentSlashProfileStatus
}

export type AgentSlashSessionCandidate = AgentSlashSSHSessionCandidate | AgentSlashFileSessionCandidate
export type AgentSlashProfileCandidate = AgentSlashSSHProfileCandidate | AgentSlashFileProfileCandidate
export type AgentSlashCandidate = AgentSlashSessionCandidate | AgentSlashProfileCandidate | AgentSlashDesktopCandidate

export interface AgentSlashCandidateCatalog {
  workflow?: { workflow: AgentSlashWorkflowCandidate[] }
  session: {
    ssh: AgentSlashSSHSessionCandidate[]
    file: AgentSlashFileSessionCandidate[]
    desktop?: AgentSlashDesktopSessionCandidate[]
  }
  profile: {
    ssh: AgentSlashSSHProfileCandidate[]
    file: AgentSlashFileProfileCandidate[]
    desktop?: AgentSlashDesktopProfileCandidate[]
  }
}

export interface AgentSlashDesktopSessionCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'desktop_session'; resource_kind: 'desktop'; session_id: string
  connection_generation: number; protocol: 'rdp' | 'vnc'; started_at: string
  status: 'ready' | 'unavailable'
}
export interface AgentSlashDesktopProfileCandidate extends AgentSlashConnectionCandidateBase {
  kind: 'desktop_profile'; resource_kind: 'desktop'; protocol: 'rdp' | 'vnc'
  status: 'ready' | 'unavailable'
}
export interface AgentSlashWorkflowCandidate extends AgentSlashCandidateBase {
  kind: 'desktop_workflow'; resource_kind: 'workflow'; workflow_id: string
  workflow_name: string; workflow_version: number; status: 'ready' | 'unavailable'
}
export type AgentSlashDesktopCandidate = AgentSlashDesktopSessionCandidate | AgentSlashDesktopProfileCandidate | AgentSlashWorkflowCandidate

export function agentSlashKindsForCommand(command: AgentSlashCommandId): AgentSlashResourceKind[] {
  return command === 'workflow' ? ['workflow'] : command === 'compact' ? [] : ['ssh', 'file', 'desktop']
}
export function agentSlashCatalogCandidates(catalog: AgentSlashCandidateCatalog, command: AgentSlashCommandId, kind: AgentSlashResourceKind): AgentSlashCandidate[] {
  if (command === 'workflow') return kind === 'workflow' ? catalog.workflow?.workflow ?? [] : []
  if (command === 'compact' || kind === 'workflow') return []
  return catalog[command][kind] ?? []
}
