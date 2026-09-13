import {
  getAgentResourceBindingBySlot,
  type AgentResourceBinding,
  type AgentSlashCandidate,
  type AgentSlashCandidateCatalog,
} from '#entities/agent'

export function projectCurrentAgentSlashCandidates(
  catalog: AgentSlashCandidateCatalog,
  bindings: readonly AgentResourceBinding[] | undefined,
  connectSSHProfileOnBind = false,
): AgentSlashCandidateCatalog {
  const mutableBindings = bindings ? [...bindings] : undefined
  const sshBinding = getAgentResourceBindingBySlot(mutableBindings, 'ssh')
  const fileBinding = getAgentResourceBindingBySlot(mutableBindings, 'file')
  const mark = <Candidate extends AgentSlashCandidate>(candidate: Candidate): Candidate => ({
    ...candidate,
    current: candidate.kind === 'ssh_session'
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
    session: {
      ssh: prioritize(catalog.session.ssh),
      file: prioritize(catalog.session.file),
    },
    profile: {
      ssh: prioritize(catalog.profile.ssh),
      file: prioritize(catalog.profile.file),
    },
  }
}
