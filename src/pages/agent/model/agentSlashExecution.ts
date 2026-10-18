import { agentSlashCatalogCandidates } from '#entities/agent'
import type {
  AgentResourceBinding,
  AgentSlashCandidate,
  AgentSlashCandidateCatalog,
  AgentSlashCommandId,
  AgentSlashResourceKind,
} from '#entities/agent'

export interface AgentSlashCaptureSnapshot {
  owner: string
  start: number
  end: number
  raw_fragment: string
}

export interface AgentSlashExecutionSnapshot {
  command_id: AgentSlashCommandId
  resource_kind?: AgentSlashResourceKind
  candidate?: AgentSlashCandidate
  capture: AgentSlashCaptureSnapshot
}

export function compactDraftHasPayload(value: string) {
  return value.replace(/(^| )\/[a-z]*(?= |\r?\n|$)(?: |\r?\n)?/, '$1').trim().length > 0
}

export function slashCommandAvailability(enabled: boolean, disabledReason?: string) {
  return enabled
    ? { enabled: true }
    : { enabled: false, disabled_reason: disabledReason ?? 'workspace_unavailable' }
}

export function slashDisabledReason(input: {
  archived?: boolean
  activeRun: boolean
  editing: boolean
  busy: boolean
  queued: boolean
  connection: boolean
}) {
  if (input.archived) return 'archived'
  if (input.activeRun) return 'active_run'
  if (input.editing) return 'queued_edit'
  if (input.busy) return 'mutation_busy'
  if (input.connection) return 'resource_busy'
  if (input.queued) return 'queued_messages'
  return 'workspace_unavailable'
}

export function compactSlashDisabledReason(input: {
  archived?: boolean
  selected: boolean
  draft: string
  activeRun: boolean
  editing: boolean
  busy: boolean
  unavailable: boolean
}) {
  if (input.archived) return 'archived'
  if (input.activeRun) return 'active_run'
  if (input.editing) return 'queued_edit'
  if (input.busy) return 'mutation_busy'
  if (input.unavailable) return 'compression_unavailable'
  if (!input.selected && !compactDraftHasPayload(input.draft)) return 'empty_draft'
  return 'workspace_unavailable'
}

export function slashCaptureMatches(value: string, capture: AgentSlashCaptureSnapshot) {
  return Number.isSafeInteger(capture.start)
    && Number.isSafeInteger(capture.end)
    && capture.start >= 0
    && capture.end >= capture.start
    && value.slice(capture.start, capture.end) === capture.raw_fragment
}

export function consumeSlashCaptureText(value: string, capture: AgentSlashCaptureSnapshot) {
  if (!slashCaptureMatches(value, capture)) return value
  return value.slice(0, capture.start) + value.slice(capture.end)
}

export function latestSlashCandidate(
  catalog: AgentSlashCandidateCatalog,
  execution: AgentSlashExecutionSnapshot,
) {
  if (execution.command_id === 'compact' || !execution.resource_kind || !execution.candidate) return undefined
  return agentSlashCatalogCandidates(catalog, execution.command_id, execution.resource_kind)
    .find(({ id }) => id === execution.candidate?.id)
}

export function latestSlashMutationCandidate(
  catalog: AgentSlashCandidateCatalog,
  execution: AgentSlashExecutionSnapshot,
) {
  const selected = execution.candidate
  if (selected?.kind !== 'file_session') return latestSlashCandidate(catalog, execution)
  if (execution.command_id !== 'session' || execution.resource_kind !== 'file') return undefined
  return catalog.profile.file.find((profile) => (
    profile.file_access_profile_id === selected.file_access_profile_id
    && profile.profile_id === selected.profile_id
    && profile.host_id === selected.host_id
  ))
}

export function sameSlashCandidateIdentity(left: AgentSlashCandidate, right: AgentSlashCandidate) {
  if (left.kind === 'desktop_workflow' || right.kind === 'desktop_workflow') return left.kind === 'desktop_workflow' && right.kind === 'desktop_workflow' && left.id === right.id
    && left.workflow_id === right.workflow_id && left.workflow_version === right.workflow_version
  if (left.id !== right.id || left.kind !== right.kind || left.resource_kind !== right.resource_kind
    || left.host_id !== right.host_id || left.profile_id !== right.profile_id) return false
  if (left.kind === 'desktop_session' && right.kind === 'desktop_session') return left.session_id === right.session_id && left.connection_generation === right.connection_generation && left.protocol === right.protocol && right.status === 'ready'
  if (left.kind === 'desktop_profile' && right.kind === 'desktop_profile') return left.protocol === right.protocol
  if (left.kind === 'ssh_session' && right.kind === 'ssh_session') {
    return left.session_id === right.session_id
      && left.ssh_profile_id === right.ssh_profile_id
      && left.started_at === right.started_at
      && right.status === 'ready'
  }
  if (left.kind === 'file_session' && right.kind === 'file_session') {
    return left.file_access_profile_id === right.file_access_profile_id
  }
  if (left.kind === 'ssh_profile' && right.kind === 'ssh_profile') {
    return left.ssh_profile_id === right.ssh_profile_id
  }
  return left.kind === 'file_profile'
    && right.kind === 'file_profile'
    && left.file_access_profile_id === right.file_access_profile_id
}

export function slashCandidateMatchesBinding(
  candidate: AgentSlashCandidate,
  binding: AgentResourceBinding | undefined,
) {
  if (!binding) return false
  if (candidate.kind === 'desktop_workflow') return binding.kind === 'desktop_workflow' && candidate.workflow_id === binding.workflow_id && candidate.workflow_version === binding.workflow_version
  if (candidate.host_id !== binding.host_id) return false
  if (candidate.kind === 'desktop_session') return binding.kind === 'desktop_session' && candidate.session_id === binding.session_id && candidate.profile_id === binding.desktop_profile_id && candidate.connection_generation === binding.connection_generation && candidate.protocol === binding.protocol
  if (candidate.kind === 'desktop_profile') return binding.kind === 'desktop_profile' && candidate.profile_id === binding.desktop_profile_id && candidate.protocol === binding.protocol
  if (candidate.kind === 'ssh_session') {
    return binding.kind === 'ssh_session'
      && candidate.session_id === binding.session_id
      && candidate.ssh_profile_id === binding.ssh_profile_id
  }
  if (candidate.kind === 'ssh_profile') {
    return (binding.kind === 'ssh_session' || binding.kind === 'ssh_profile') && candidate.ssh_profile_id === binding.ssh_profile_id
  }
  return binding.kind === 'file_profile'
    && candidate.file_access_profile_id === binding.file_access_profile_id
}
