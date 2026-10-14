import {
  getAgentResourceBindingBySlot,
  type AgentResourceBinding,
  type AgentSlashCandidate,
  type AgentSlashCandidateCatalog,
} from '#entities/agent'
import { slashCandidateMatchesBinding } from './agentSlashExecution.ts'

export function projectCurrentAgentSlashCandidates(
  catalog: AgentSlashCandidateCatalog,
  bindings: readonly AgentResourceBinding[] | undefined,
  connectSSHProfileOnBind = false,
): AgentSlashCandidateCatalog {
  const sshBinding = getAgentResourceBindingBySlot(bindings, 'ssh')
  const fileBinding = getAgentResourceBindingBySlot(bindings, 'file')
  const desktop = getAgentResourceBindingBySlot(bindings, 'desktop')
  const workflow = getAgentResourceBindingBySlot(bindings, 'workflow')
  const mark = <Candidate extends AgentSlashCandidate>(candidate: Candidate): Candidate => ({
    ...candidate,
    current: candidate.kind === 'desktop_session' || candidate.kind === 'desktop_profile' ? slashCandidateMatchesBinding(candidate, desktop)
      : candidate.kind === 'desktop_workflow' ? slashCandidateMatchesBinding(candidate, workflow)
      : candidate.kind === 'ssh_session'
      ? sshBinding?.kind === 'ssh_session' && candidate.session_id === sshBinding.session_id
      : candidate.kind === 'ssh_profile'
        ? candidate.ssh_profile_id === sshBinding?.ssh_profile_id
          && sshBinding.kind === (connectSSHProfileOnBind ? 'ssh_session' : 'ssh_profile')
        : candidate.file_access_profile_id === fileBinding?.file_access_profile_id,
  })
  const prioritize = <Candidate extends AgentSlashCandidate>(items: readonly Candidate[]) => (
    items.map(mark).sort((left, right) => Number(right.current) - Number(left.current))
  )
  return {
    ...(catalog.workflow ? { workflow: { workflow: prioritize(catalog.workflow.workflow) } } : {}),
    session: {
      ssh: prioritize(catalog.session.ssh),
      file: prioritize(catalog.session.file),
      ...(catalog.session.desktop ? { desktop: prioritize(catalog.session.desktop) } : {}),
    },
    profile: {
      ssh: prioritize(catalog.profile.ssh),
      file: prioritize(catalog.profile.file),
      ...(catalog.profile.desktop ? { desktop: prioritize(catalog.profile.desktop) } : {}),
    },
  }
}
