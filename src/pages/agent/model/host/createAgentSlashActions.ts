import {
  agentResourceBindingKey,
  getAgentResourceBindingBySlot,
  isAgentResourceRecoveryBlocking,
  type AgentResourceReference,
  type AgentSession
} from '#entities/agent'
import {
  isAgentResourceBindingConnectionBlocking
} from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import {
  type AgentWorkspaceSlashExecution
} from '#widgets/agent-workspace'
import {
  consumeSlashCaptureText,
  latestSlashCandidate,
  latestSlashMutationCandidate,
  sameSlashCandidateIdentity,
  slashCandidateMatchesBinding,
  slashCaptureMatches
} from '../agentSlashExecution.ts'
import { notifyError, requireSession, slashBindingLabel, slashCandidateLabel, slashCandidateMatchesExpectedBinding } from './agentHostHelpers.ts'

interface Context {
  slashExecutionSessionIdsRef: React.RefObject<Set<string>>
  setSlashExecutionSessionIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  modal: import('../surface/agentFeedback.ts').AgentFeedback['modal']
  t: import('i18next').TFunction<"translation", undefined>
  controller: import('#features/agent-runtime').AgentWorkspaceController
  slashAvailability: import('#widgets/agent-workspace').AgentWorkspaceSlashAvailability
  ensureDraftSession: (selectionRevision: number) => Promise<import('#entities/agent').AgentSession>
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  remote: boolean
  slashCandidatesRef: React.RefObject<import('#entities/agent').AgentSlashCandidateCatalog>
  recovery: ReturnType<typeof import('#features/agent-runtime').useAgentResourceRecovery>
  profileConnection: ReturnType<typeof import('#features/agent-runtime').useAgentResourceBindingConnection>
  readiness: import('#entities/agent').AgentReadiness
  connectSSHProfileBinding: (sessionId: string, sshProfileId: string) => Promise<boolean>
  performResourceMutation: (sessionId: string, operation: () => Promise<unknown>) => Promise<boolean>
  notifyResourceBindingCompleted: (sessionId: string, candidate: import('#entities/agent').AgentSlashCandidate) => void
  sshResourcesRef: React.RefObject<readonly import('#entities/agent').AgentSSHResourceState[]>
  draftSessionCoordinator: import('#features/agent-runtime').AgentDraftSessionCoordinator
  setDraftGroupId: React.Dispatch<React.SetStateAction<string | undefined>>
  setComposerFocusKey: React.Dispatch<React.SetStateAction<number>>
}

export function createAgentSlashActions({ slashExecutionSessionIdsRef, setSlashExecutionSessionIds, modal, t, controller, slashAvailability, ensureDraftSession, notificationRef, tRef, remote, slashCandidatesRef, recovery, profileConnection, readiness, connectSSHProfileBinding, performResourceMutation, notifyResourceBindingCompleted, sshResourcesRef, draftSessionCoordinator, setDraftGroupId, setComposerFocusKey }: Context) {
  const updateSlashExecutionSessions = (sessionIds: readonly string[], executing: boolean) => {
    for (const sessionId of sessionIds) {
      if (executing) slashExecutionSessionIdsRef.current.add(sessionId)
      else slashExecutionSessionIdsRef.current.delete(sessionId)
    }
    setSlashExecutionSessionIds(new Set(slashExecutionSessionIdsRef.current))
  }

  const confirmSlashReplacement = (currentHost: string, nextHost: string) => new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (accepted: boolean) => {
      if (settled) return
      settled = true
      resolve(accepted)
    }
    modal.confirm({
      className: 'termous-modal',
      centered: true,
      title: t('agent.slash.replace.title'),
      content: t('agent.slash.replace.description', { current: currentHost, next: nextHost }),
      okText: t('agent.slash.replace.confirm'),
      cancelText: t('app.cancel'),
      onOk: () => settle(true),
      onCancel: () => settle(false),
      afterClose: () => settle(false),
    })
  })

  const executeSlashCommand = async (execution: AgentWorkspaceSlashExecution): Promise<boolean> => {
    const invocation = controller.getSnapshot()
    const originalDraft = invocation.drafts[execution.capture.owner]?.text ?? ''
    if (!slashCaptureMatches(originalDraft, execution.capture)) return false
    const commandAvailability = slashAvailability[execution.command_id]
    if (!commandAvailability?.enabled
      || execution.resource_kind && commandAvailability.resource_kinds?.[execution.resource_kind]?.enabled === false) return false
    if (execution.command_id === 'compact' && execution.capture.owner === 'new'
      && !consumeSlashCaptureText(originalDraft, execution.capture).trim()) return false

    let targetSession = execution.capture.owner === 'new'
      ? undefined
      : invocation.sessions.find(({ id }) => id === execution.capture.owner)
    let pendingDraftSession: Promise<AgentSession> | undefined
    const selectionRevision = invocation.selection_intent_revision
    if (execution.capture.owner === 'new' && invocation.selected_session_id) return false
    if (execution.capture.owner !== 'new'
      && (!targetSession || invocation.selected_session_id !== targetSession.id || targetSession.archived_at)) return false
    if (slashExecutionSessionIdsRef.current.has(execution.capture.owner)) return false
    const trackedExecutionSessionIds = [execution.capture.owner]
    updateSlashExecutionSessions(trackedExecutionSessionIds, true)
    if (execution.capture.owner === 'new') {
      pendingDraftSession = ensureDraftSession(selectionRevision)
      try {
        targetSession = await pendingDraftSession
      } catch (error) {
        updateSlashExecutionSessions(trackedExecutionSessionIds, false)
        notifyError(notificationRef.current, tRef.current, error, 'generic', remote)
        return false
      }
      trackedExecutionSessionIds.push(targetSession.id)
      updateSlashExecutionSessions([targetSession.id], true)
      const latest = controller.getSnapshot()
      if (latest.selected_session_id !== targetSession.id && latest.drafts[targetSession.id] === undefined) {
        controller.updateDraft(targetSession.id, originalDraft)
      }
    }
    if (!targetSession) {
      updateSlashExecutionSessions(trackedExecutionSessionIds, false)
      return false
    }

    let accepted = false
    try {
      if (execution.command_id === 'compact') {
        const latest = requireSession(controller.getSnapshot().sessions, targetSession.id)
        controller.setContextCompressionPending(latest.id, true)
        notificationRef.current.success({
          key: `agent-compact-pending-${latest.id}`,
          placement: 'topRight',
          title: tRef.current('agent.slash.compact.accepted'),
          description: tRef.current('agent.slash.compact.acceptedDescription'),
          duration: 2,
          showProgress: false,
          role: 'status',
          className: termousNotificationClassName,
        })
        accepted = true
      } else {
        const candidate = latestSlashCandidate(slashCandidatesRef.current, execution)
        if (!candidate || candidate.disabled_reason) return false
        const beforeConfirmation = requireSession(controller.getSnapshot().sessions, targetSession.id)
        const currentBinding = getAgentResourceBindingBySlot(
          beforeConfirmation.resource_bindings,
          candidate.resource_kind,
        )
        const sourceBindingKey = agentResourceBindingKey(currentBinding)
        const replacing = currentBinding && !slashCandidateMatchesBinding(candidate, currentBinding)
        if (replacing && !await confirmSlashReplacement(
          slashBindingLabel(currentBinding, slashCandidatesRef.current),
          slashCandidateLabel(candidate),
        )) return false

        const beforeMutation = controller.getSnapshot()
        const currentCandidate = latestSlashMutationCandidate(slashCandidatesRef.current, execution)
        if (!currentCandidate || currentCandidate.disabled_reason
          || candidate.kind !== 'file_session'
          && !sameSlashCandidateIdentity(candidate, currentCandidate)) return false
        const latestSession = requireSession(beforeMutation.sessions, targetSession.id)
        const latestBinding = getAgentResourceBindingBySlot(
          latestSession.resource_bindings,
          candidate.resource_kind,
        )
        if (agentResourceBindingKey(latestBinding) !== sourceBindingKey) return false
        if (currentCandidate.resource_kind === 'ssh'
          && (isAgentResourceRecoveryBlocking(recovery.coordinator.getSnapshot()[latestSession.id])
            || isAgentResourceBindingConnectionBlocking(
              profileConnection.coordinator.getSnapshot()[latestSession.id],
            ))) return false

        if (currentCandidate.kind === 'ssh_profile') {
          if (readiness.settings.connect_ssh_profile_on_bind) {
            accepted = await connectSSHProfileBinding(latestSession.id, currentCandidate.ssh_profile_id)
          } else {
            const reference: AgentResourceReference = {
              kind: 'ssh_profile',
              ssh_profile_id: currentCandidate.ssh_profile_id,
            }
            accepted = slashCandidateMatchesExpectedBinding(currentCandidate, latestBinding)
              || await performResourceMutation(latestSession.id, () => controller.replaceResourceBinding(latestSession.id, {
                ...reference,
                expected_revision: latestSession.revision,
              }))
            if (accepted) notifyResourceBindingCompleted(latestSession.id, currentCandidate)
          }
        } else {
          const reference: AgentResourceReference = currentCandidate.kind === 'desktop_session'
            ? { kind: 'desktop_session', session_id: currentCandidate.session_id, connection_generation: currentCandidate.connection_generation }
            : currentCandidate.kind === 'desktop_profile' ? { kind: 'desktop_profile', desktop_profile_id: currentCandidate.profile_id }
              : currentCandidate.kind === 'desktop_workflow' ? { kind: 'desktop_workflow', workflow_id: currentCandidate.workflow_id, workflow_version: currentCandidate.workflow_version }
                : currentCandidate.kind === 'ssh_session'
                  ? { kind: 'ssh_session', session_id: currentCandidate.session_id }
                  : { kind: 'file_profile', file_access_profile_id: currentCandidate.file_access_profile_id }
          if (currentCandidate.kind === 'ssh_session' && !sshResourcesRef.current.some((resource) => (
            resource.session_id === currentCandidate.session_id
            && resource.host_id === currentCandidate.host_id
            && resource.ssh_profile_id === currentCandidate.ssh_profile_id
            && resource.started_at === currentCandidate.started_at
            && resource.status === 'ready'
          ))) return false
          accepted = slashCandidateMatchesExpectedBinding(currentCandidate,
            getAgentResourceBindingBySlot(
              latestSession.resource_bindings,
              currentCandidate.resource_kind,
            ))
            || await performResourceMutation(latestSession.id, () => controller.replaceResourceBinding(latestSession.id, {
              ...reference,
              expected_revision: latestSession.revision,
            }))
          if (accepted) notifyResourceBindingCompleted(latestSession.id, currentCandidate)
        }
      }
    } catch (error) {
      notifyError(
        notificationRef.current,
        tRef.current,
        error,
        execution.command_id === 'compact' ? 'generic' : 'resource',
        remote,
      )
    } finally {
      if (pendingDraftSession) draftSessionCoordinator.release(pendingDraftSession)
      if (pendingDraftSession) {
        const latest = controller.getSnapshot()
        const latestNewDraft = latest.drafts.new?.text ?? ''
        if (!latest.selected_session_id && latest.selection_intent_revision === selectionRevision
          && slashCaptureMatches(latestNewDraft, execution.capture)) {
          controller.updateDraft(targetSession.id, latestNewDraft)
          controller.updateDraft('new', '')
          controller.selectSession(targetSession.id)
          setDraftGroupId(undefined)
          setComposerFocusKey((current) => current + 1)
        }
      }
      updateSlashExecutionSessions(trackedExecutionSessionIds, false)
    }

    if (!accepted) return false
    if (execution.capture.owner !== 'new') {
      // 已有会话保留原 owner，由 Widget 使用捕获片段做最终 CAS 消费。
      return true
    }

    const latest = controller.getSnapshot()
    const targetDraft = latest.drafts[targetSession.id]?.text ?? ''
    if (slashCaptureMatches(targetDraft, execution.capture)) {
      controller.updateDraft(targetSession.id, consumeSlashCaptureText(targetDraft, execution.capture))
    }
    if (!latest.selected_session_id && latest.selection_intent_revision === selectionRevision
      && slashCaptureMatches(latest.drafts.new?.text ?? '', execution.capture)) {
      controller.updateDraft('new', '')
      controller.selectSession(targetSession.id)
      setDraftGroupId(undefined)
      setComposerFocusKey((current) => current + 1)
    }
    // 新草稿的 owner 迁移由页面完成；Widget 会因 owner 变化主动丢弃旧执行回执。
    return false
  }

  return { executeSlashCommand }
}
