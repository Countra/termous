import {
  agentResourceBindingKey,
  getAgentResourceBinding,
  getAgentResourceBindingBySlot,
  type AgentSSHProfileResourceState,
  type AgentSession,
  type AgentSlashCandidate
} from '#entities/agent'
import {
  useAgentResourceBindingConnection,
  useAgentResourceRecovery
} from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import { useCallback, useMemo } from 'react'
import { projectCurrentAgentSlashCandidates } from '../agentSlashProjection.ts'
import { notifyError, projectResourceContext, slashCandidateMatchesExpectedBinding } from './agentHostHelpers.ts'

interface Context {
  controller: import('#features/agent-runtime').AgentWorkspaceController
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  gateway: import('#features/agent-runtime').AgentWorkspaceGateway
  selected: import('#entities/agent').AgentSession | undefined
  enabled: boolean
  active: boolean
  state: import('#features/agent-runtime').AgentWorkspaceState
  selectedQueueState: import('#entities/agent').AgentQueueState | undefined
  sshResources: import('#entities/agent').AgentSSHResourceState[]
  readiness: import('#entities/agent').AgentReadiness | null
  backgroundActive: boolean
  setDismissedProfileConnectionKey: React.Dispatch<React.SetStateAction<string | undefined>>
  remote: boolean
  selectedQueuedTurnEdit: ReturnType<import('#features/agent-runtime').AgentWorkspaceController['getSnapshot']>['queued_turn_edits'][string] | undefined
  queuedTurnEditAttachments: ReturnType<typeof import('#features/agent-runtime').useAgentDraftAttachments>
  getQueuedEditOwner: (sessionId: string) => string | undefined
  draftAttachments: ReturnType<typeof import('#features/agent-runtime').useAgentDraftAttachments>
  slashCandidates: import('#entities/agent').AgentSlashCandidateCatalog
  fileResources: import('#entities/agent').AgentFileResourceState[]
  desktopResources: import('#entities/agent').AgentDesktopResourceState[]
  slashCandidatesRef: React.RefObject<import('#entities/agent').AgentSlashCandidateCatalog>
  sshResourcesRef: React.RefObject<readonly import('#entities/agent').AgentSSHResourceState[]>
  workflowResourcesReady: boolean
  desktopResourcesReady: boolean
  fileResourcesReady: boolean
  sshProfileResourcesReady: boolean
  sshResourcesReady: boolean
}

export function useAgentResourceWorkspace({ controller, notificationRef, tRef, gateway, selected, enabled, active, state, selectedQueueState, sshResources, readiness, backgroundActive, setDismissedProfileConnectionKey, remote, selectedQueuedTurnEdit, queuedTurnEditAttachments, getQueuedEditOwner, draftAttachments, slashCandidates, fileResources, desktopResources, slashCandidatesRef, sshResourcesRef, workflowResourcesReady, desktopResourcesReady, fileResourcesReady, sshProfileResourcesReady, sshResourcesReady }: Context) {
  const notifyRecoveryCompleted = useCallback((recovered: AgentSession) => {
    const current = controller.getSnapshot().sessions.find((session) => session.id === recovered.id)
    if (!current || current.archived_at || agentResourceBindingKey(getAgentResourceBinding(current.resource_bindings, 'ssh_session'))
      !== agentResourceBindingKey(getAgentResourceBinding(recovered.resource_bindings, 'ssh_session'))) return
    notificationRef.current.success({
      key: `agent-resource-recovery-${recovered.id}`,
      placement: 'topRight',
      title: tRef.current('agent.resource.recovery.completed'),
      description: tRef.current('agent.resource.recovery.completedDescription'),
      duration: 2,
      showProgress: false,
      role: 'status',
      className: termousNotificationClassName,
    })
  }, [controller, notificationRef, tRef])
  const recovery = useAgentResourceRecovery(gateway, controller, selected,
    enabled && active && state.snapshot_complete, selectedQueueState?.revision, sshResources, readiness, notifyRecoveryCompleted, backgroundActive)
  const notifyConnectionCompleted = useCallback((connected: AgentSession) => {
    const current = controller.getSnapshot().sessions.find((session) => session.id === connected.id)
    if (!current || current.archived_at || agentResourceBindingKey(getAgentResourceBindingBySlot(current.resource_bindings, 'ssh'))
      !== agentResourceBindingKey(getAgentResourceBindingBySlot(connected.resource_bindings, 'ssh'))) return
    notificationRef.current.success({
      key: `agent-resource-connection-${connected.id}`,
      placement: 'topRight',
      title: tRef.current('agent.slash.connection.completed'),
      description: tRef.current('agent.slash.connection.completedDescription'),
      duration: 2,
      showProgress: false,
      role: 'status',
      className: termousNotificationClassName,
    })
  }, [controller, notificationRef, tRef])
  const notifyResourceBindingCompleted = useCallback((sessionId: string, candidate: AgentSlashCandidate) => {
    const current = controller.getSnapshot().sessions.find((session) => session.id === sessionId)
    const binding = current && getAgentResourceBindingBySlot(
      current.resource_bindings,
      candidate.resource_kind,
    )
    if (!current || current.archived_at || !slashCandidateMatchesExpectedBinding(candidate, binding)) return
    notificationRef.current.success({
      key: `agent-resource-binding-${sessionId}-${candidate.resource_kind}`,
      placement: 'topRight',
      title: tRef.current('agent.slash.binding.completed'),
      description: tRef.current('agent.slash.binding.completedDescription'),
      duration: 2,
      showProgress: false,
      role: 'status',
      className: termousNotificationClassName,
    })
  }, [controller, notificationRef, tRef])
  const connectionObservationRevision = `${selectedQueueState?.revision ?? 0}:${selected ? state.active_run_ids[selected.id] ?? '' : ''}:${sshResources
    .map((resource) => `${resource.session_id}:${resource.status}:${resource.started_at}`).join('|')}`
  const profileConnection = useAgentResourceBindingConnection(
    gateway,
    controller,
    selected,
    enabled && active && state.snapshot_complete,
    connectionObservationRevision,
    notifyConnectionCompleted,
    backgroundActive,
  )
  const connectSSHProfileBinding = async (sessionId: string, sshProfileId: string) => {
    const latestSession = controller.getSnapshot().sessions.find((session) => session.id === sessionId)
    if (!latestSession || latestSession.archived_at) return false
    setDismissedProfileConnectionKey(undefined)
    const accepted = await profileConnection.coordinator.connect(latestSession, sshProfileId)
    if (!accepted) {
      notifyError(notificationRef.current, tRef.current,
        new Error(profileConnection.coordinator.getSnapshot()[latestSession.id]?.error_code
          ?? 'AGENT_RESOURCE_CONNECTION_FAILED'), 'resource', remote)
    }
    return accepted
  }
  const profileConnectionPresentationKey = profileConnection.state?.view?.operation
    ? `${profileConnection.state.view.instance_id}:${profileConnection.state.view.operation.id}`
    : profileConnection.state?.error_code
      ? `${selected?.id ?? 'new'}:${profileConnection.state.uncertain ? 'uncertain' : 'failed'}:${profileConnection.state.error_code}`
      : profileConnection.state?.uncertain
        ? `${selected?.id ?? 'new'}:uncertain`
        : undefined
  const selectedDraftAttachmentRecords = selected && selectedQueuedTurnEdit
    ? queuedTurnEditAttachments.records[selected.id]?.filter((record) => !record.owner_id || record.owner_id === getQueuedEditOwner(selected.id))
    : draftAttachments.records[selected?.id ?? 'new']
  const projectedDraftAttachments = useMemo(
    () => (selectedDraftAttachmentRecords ?? []).map((record) => ({
      client_id: record.client_id,
      name: record.file.name,
      size_bytes: record.file.size,
      kind: record.kind,
      file: record.file,
      phase: record.phase,
      attachment: record.attachment,
      error_code: record.error_code,
      origin: record.origin,
    })),
    [selectedDraftAttachmentRecords],
  )
  const sshProfileResources = useMemo<AgentSSHProfileResourceState[]>(() => slashCandidates.profile.ssh.map((candidate) => ({
    host_id: candidate.host_id,
    ssh_profile_id: candidate.ssh_profile_id,
    host_name: candidate.host_name,
    ssh_profile_name: candidate.profile_name,
    platform: 'linux',
    status: candidate.disabled_reason ? 'unavailable' : 'ready',
  })), [slashCandidates.profile.ssh])
  const resources = useMemo(
    () => [...sshResources, ...sshProfileResources, ...fileResources, ...desktopResources],
    [sshResources, sshProfileResources, fileResources, desktopResources],
  )
  const currentSlashCandidates = useMemo(
    () => projectCurrentAgentSlashCandidates(
      slashCandidates,
      selected?.resource_bindings,
      readiness?.settings.connect_ssh_profile_on_bind,
    ),
    [readiness?.settings.connect_ssh_profile_on_bind, selected?.resource_bindings, slashCandidates],
  )
  slashCandidatesRef.current = currentSlashCandidates
  sshResourcesRef.current = sshResources
  const resourceContexts = useMemo(
    () => (selected?.resource_bindings ?? []).map((binding) => projectResourceContext(
      binding,
      resources,
      (binding.kind === 'desktop_workflow' ? workflowResourcesReady
        : binding.kind === 'desktop_session' || binding.kind === 'desktop_profile' ? desktopResourcesReady
          : binding.kind === 'file_profile'
            ? fileResourcesReady
            : binding.kind === 'ssh_profile' ? sshProfileResourcesReady : sshResourcesReady)
      && state.snapshot_complete,
    )).map((context) => context.binding.kind === 'ssh_session' ? { ...context, recovery: recovery.state } : context),
    [selected?.resource_bindings, resources, sshResourcesReady, sshProfileResourcesReady,
      fileResourcesReady, desktopResourcesReady, workflowResourcesReady, state.snapshot_complete, recovery.state],
  )

  return { recovery, profileConnection, connectSSHProfileBinding, profileConnectionPresentationKey, projectedDraftAttachments, resources, currentSlashCandidates, resourceContexts, notifyResourceBindingCompleted }
}
