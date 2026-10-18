import type { AgentDesktopResourceState } from '#entities/agent'
import {
  isAgentModelRunnable,
  type AgentFileResourceState,
  type AgentLaunchIntent,
  type AgentReferenceTargetsSnapshot,
  type AgentResourceReferenceLaunch,
  type AgentSSHResourceState,
  type AgentSession,
  type AgentSlashCandidateCatalog
} from '#entities/agent'
import { isTransientRemoteReadError } from '#entities/remote-control'
import {
  agentApprovalModeFromBypass,
  agentApprovalModeToBypass,
  type AgentApprovalMode,
} from '#features/agent-approval-policy'
import {
  AgentDraftSessionCoordinator,
  AgentWorkspaceController,
  projectAgentReferenceTargets,
  useAgentArchives,
  useAgentQueuedTurnEditOwners,
  useAgentSessionManagement,
  useAgentTerminalReferenceImport,
  type AgentWorkspaceGateway
} from '#features/agent-runtime'
import { loadAgentModelCatalog, type AgentSetupGateway } from '#features/agent-setup'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveAgentModelReasoningLevel } from '../model/agentModelSelection.ts'
import {
  agentRunInteractionBlocked,
  agentWorkspaceInfrastructureReady,
  latestSessionRun,
  projectAgentMessages,
  projectAgentModelOptions,
  projectAgentSessions
} from '../model/agentWorkspaceProjection.ts'
import { createOperationBusy, notifyError, type AgentOperationBusy } from '../model/host/agentHostHelpers.ts'
import { createAgentQueueActions } from '../model/host/createAgentQueueActions.ts'
import { createAgentResourceActions } from '../model/host/createAgentResourceActions.ts'
import { createAgentSessionActions } from '../model/host/createAgentSessionActions.ts'
import { createAgentSlashActions } from '../model/host/createAgentSlashActions.ts'
import { createAgentSubmissionActions } from '../model/host/createAgentSubmissionActions.ts'
import { projectAgentSurfaceStatus } from '../model/host/projectAgentSurfaceStatus.ts'
import { useAgentAttachmentWorkspace } from '../model/host/useAgentAttachmentWorkspace.ts'
import { useAgentDraftOwnership } from '../model/host/useAgentDraftOwnership.ts'
import { useAgentOperationLanes } from '../model/host/useAgentOperationLanes.ts'
import { useAgentResourceWorkspace } from '../model/host/useAgentResourceWorkspace.ts'
import { useAgentSetupState } from '../model/host/useAgentSetupState.ts'
import type { AgentSurfaceModel } from '../model/surface/agentSurfaceModel.ts'
import { useAgentSyncWarning } from '../model/useAgentSyncWarning.ts'

const noSSHResources: AgentSSHResourceState[] = []
const noSlashCandidates: AgentSlashCandidateCatalog = {
  session: { ssh: [], file: [] },
  profile: { ssh: [], file: [] },
}

export function AgentWorkspaceHost({
  backgroundActive = false,
  feedback,
  renderSurface,
  notificationSessionId,
  onNotificationSessionHandled,
  gateway,
  setupGateway,
  sshResources = noSSHResources,
  sshResourcesReady = false,
  fileResources = [],
  fileResourcesReady = sshResourcesReady,
  sshProfileResourcesReady = fileResourcesReady,
  desktopResources = [],
  desktopResourcesReady = false,
  workflowResourcesReady = false,
  slashCandidates = noSlashCandidates,
  enabled,
  active,
  launchIntent,
  onLaunchIntentHandled,
  onRuntimeSummaryChange,
  onReferenceTargetsChange,
  onOpenSettings,
  remote = false,
}: {
  backgroundActive?: boolean
  feedback: import('../model/surface/agentFeedback.ts').AgentFeedback
  renderSurface: (model: AgentSurfaceModel) => import('react').ReactNode
  gateway: AgentWorkspaceGateway
  setupGateway: Pick<AgentSetupGateway, 'readiness' | 'modelProviders' | 'models'> & Partial<Pick<AgentSetupGateway, 'setup'>>
  remote?: boolean
  sshResources?: AgentSSHResourceState[]
  sshResourcesReady?: boolean
  sshProfileResourcesReady?: boolean
  fileResources?: AgentFileResourceState[]
  fileResourcesReady?: boolean
  desktopResources?: AgentDesktopResourceState[]
  desktopResourcesReady?: boolean
  workflowResourcesReady?: boolean
  slashCandidates?: AgentSlashCandidateCatalog
  enabled: boolean
  active: boolean
  notificationSessionId?: string
  onNotificationSessionHandled?: () => void
  launchIntent?: AgentLaunchIntent | null
  onLaunchIntentHandled?: (key: number) => void
  onRuntimeSummaryChange?: (snapshot: {
    agentRunCount: number
    snapshotComplete: boolean
  }) => void
  onReferenceTargetsChange?: (snapshot: AgentReferenceTargetsSnapshot) => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const { notification, modal } = feedback
  const controller = useMemo(() => new AgentWorkspaceController({ gateway }), [gateway])
  const draftSessionCoordinator = useMemo(() => new AgentDraftSessionCoordinator(), [])
  const getQueuedEditOwner = useAgentQueuedTurnEditOwners(controller)
  const [composerFocusKey, setComposerFocusKey] = useState(0)
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const management = useAgentSessionManagement(controller, gateway, state.sessions, enabled && active)
  const [archivesOpen, setArchivesOpen] = useState(false)
  const archives = useAgentArchives(gateway, archivesOpen && enabled && active, state.sessions)
  const [notificationArchive, setNotificationArchive] = useState<string>()
  useEffect(() => {
    if (!active || !state.snapshot_complete || !notificationSessionId) return
    if (controller.getSnapshot().sessions.some(session => session.id === notificationSessionId)) {
      controller.selectSession(notificationSessionId)
      onNotificationSessionHandled?.()
      return
    }
    const abort = new AbortController()
    void gateway.session(notificationSessionId, abort.signal).then(session => {
      if (abort.signal.aborted) return
      if (session.archived_at) { setArchivesOpen(true); setNotificationArchive(session.id) }
      else onNotificationSessionHandled?.()
    }).catch(() => {
      if (!abort.signal.aborted) { notification.error({ message: t('agent.error.degraded') }); onNotificationSessionHandled?.() }
    })
    return () => abort.abort()
  }, [active, controller, gateway, notificationSessionId, onNotificationSessionHandled, state.snapshot_complete, notification, t])
  useEffect(() => {
    if (!notificationArchive || archives.listLoading || !archives.sessions.some(session => session.id === notificationArchive)) return
    archives.selectSession(notificationArchive)
    setNotificationArchive(undefined)
    onNotificationSessionHandled?.()
  }, [notificationArchive, archives, onNotificationSessionHandled])
  const [draftGroupId, setDraftGroupId] = useState<string>()

  const [operationsBySession, setOperationsBySession] = useState<Record<string, AgentOperationBusy>>({})
  const operationBusy = operationsBySession[state.selected_session_id ?? "new"] ?? createOperationBusy()

  const [dismissedProfileConnectionKey, setDismissedProfileConnectionKey] = useState<string>()
  const [slashExecutionSessionIds, setSlashExecutionSessionIds] = useState<ReadonlySet<string>>(() => new Set())

  const operationBusyRef = useRef<Record<string, AgentOperationBusy>>({})

  const notificationRef = useRef(notification)
  const tRef = useRef(t)
  const previousQueuedTurnEditSessionIdsRef = useRef(new Map<string, string>())
  const previousReferenceTargetsRef = useRef('')
  const committedQueuedTurnEditSessionIdsRef = useRef(new Set<string>())
  const slashCandidatesRef = useRef<AgentSlashCandidateCatalog>(noSlashCandidates)
  const sshResourcesRef = useRef<readonly AgentSSHResourceState[]>(noSSHResources)
  const slashExecutionSessionIdsRef = useRef(new Set<string>())
  notificationRef.current = notification
  tRef.current = t
  const { readiness, setReadiness, providers, models, setupLoading, draftModelId, setDraftModelId, draftReasoningLevel, setDraftReasoningLevel, activeSetupEpochRef, activeSetupReadyEpochRef, activeSetupAbortRef, acceptSetupSnapshot, markActiveSetupReady, hydrateActiveSetup, activeSetupReady, activeSetupFailed } = useAgentSetupState({ setupGateway, controller, remote, notificationRef, tRef, enabled, active })

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  )
  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  )
  const firstRunnableModelId = useMemo(
    () => models.find((model) => isAgentModelRunnable(model, providerById.get(model.provider_id)))?.id,
    [models, providerById],
  )
  const workspaceModelOptions = useMemo(
    () => projectAgentModelOptions(models, providerById),
    [models, providerById],
  )
  const workspaceSessions = useMemo(
    () => projectAgentSessions(state.sessions, models, providers, state.runs),
    [models, providers, state.runs, state.sessions],
  )
  const searchSessions = useMemo(
    () => projectAgentSessions(management.searchResults, models, providers, state.runs),
    [management.searchResults, models, providers, state.runs],
  )
  const archiveMessages = useMemo(() => projectAgentMessages(archives.messages, undefined, []), [archives.messages])
  const referenceTargets = useMemo(() => projectAgentReferenceTargets(state, enabled), [state, enabled])
  useEffect(() => {
    const signature = JSON.stringify(referenceTargets)
    if (signature === previousReferenceTargetsRef.current) return
    previousReferenceTargetsRef.current = signature
    onReferenceTargetsChange?.(referenceTargets)
  }, [onReferenceTargetsChange, referenceTargets])

  useEffect(() => {
    if (draftGroupId && !state.session_groups.some(({ id }) => id === draftGroupId)) setDraftGroupId(undefined)
  }, [draftGroupId, state.session_groups])

  useEffect(() => {
    if (!enabled) return
    controller.start()
    return () => controller.close()
  }, [controller, enabled])

  useEffect(() => {
    onRuntimeSummaryChange?.({
      agentRunCount: Object.keys(state.active_run_ids).length,
      snapshotComplete: enabled && state.snapshot_complete,
    })
  }, [enabled, onRuntimeSummaryChange, state.active_run_ids, state.snapshot_complete])

  const { perform, performResourceMutation } = useAgentOperationLanes({ controller, operationBusyRef, setOperationsBySession, notificationRef, tRef, remote })

  const changeApprovalMode = useCallback(async (mode: AgentApprovalMode) => {
    if (remote) throw new Error('REMOTE_OPERATION_UNSUPPORTED')
    const policy = readiness?.mcp_policy
    if (!policy) throw new Error('AGENT_MCP_POLICY_MISSING')
    const epoch = activeSetupEpochRef.current
    const isCurrent = () => activeSetupEpochRef.current === epoch
      && activeSetupReadyEpochRef.current === epoch
    const updated = await perform(async () => {
      try {
        const next = await gateway.updateMcpPolicy({
          approval_bypass: agentApprovalModeToBypass(mode),
          sync_scopes: false,
          expected_revision: policy.revision,
        })
        // 离页或重新水合后，旧策略回执不能覆盖当前页面的审批模式。
        if (!isCurrent()) return
        setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
      } catch (error) {
        if (!isCurrent()) return
        try {
          const nextReadiness = await setupGateway.readiness()
          if (isCurrent()) setReadiness(nextReadiness)
        } catch {
          // 保留原始策略更新错误；后续刷新仍会重新获取权威状态。
        }
        if (isCurrent()) throw error
      }
    })
    if (!updated) throw new Error('AGENT_MCP_POLICY_UPDATE_FAILED')
  }, [activeSetupEpochRef, activeSetupReadyEpochRef, gateway, perform, readiness?.mcp_policy, setReadiness, setupGateway, remote])

  const selected = state.sessions.find((session) => session.id === state.selected_session_id)
  const newSessionModelId = draftModelId
    ?? readiness?.settings.default_model_id
    ?? firstRunnableModelId
  const newSessionModel = newSessionModelId ? modelById.get(newSessionModelId) : undefined
  const newSessionModelRunnable = Boolean(newSessionModel && isAgentModelRunnable(
    newSessionModel,
    providerById.get(newSessionModel.provider_id),
  ))
  const newSessionReasoningLevel = resolveAgentModelReasoningLevel(
    newSessionModel,
    draftReasoningLevel ?? newSessionModel?.effective_default_reasoning_level ?? 'off',
  )
  const workspaceInfrastructureReady = Boolean(
    readiness && agentWorkspaceInfrastructureReady(readiness),
  )
  const { createDraftSession, ensureDraftSession, ensureAttachmentSession } = useAgentDraftOwnership({ controller, newSessionModelId, modelById, providerById, tRef, draftGroupId, newSessionReasoningLevel, setDraftGroupId, draftSessionCoordinator })

  const { loadAttachmentContent, loadToolImage, draftAttachments, queuedTurnEditAttachments } = useAgentAttachmentWorkspace({ notificationRef, tRef, gateway, ensureAttachmentSession, controller, committedQueuedTurnEditSessionIdsRef, getQueuedEditOwner, state, previousQueuedTurnEditSessionIdsRef })

  const syncWarningVisible = useAgentSyncWarning(
    activeSetupFailed ? 'setup' : state.error_code,
    remote && !activeSetupFailed && isTransientRemoteReadError({ code: state.error_code }),
  )
  const selectedRun = useMemo(() => {
    if (!selected) return undefined
    const activeRun = selected && state.active_run_ids[selected.id] ? state.runs[state.active_run_ids[selected.id]!] : undefined
    return activeRun?.session_id === selected.id
      ? activeRun
      : latestSessionRun(selected.id, state.runs)
  }, [selected, state.active_run_ids, state.runs])
  const selectedMessageEntities = selected ? state.messages[selected.id] : undefined
  const selectedRunEvents = selectedRun ? state.run_events[selectedRun.id] : undefined
  const workspaceMessages = useMemo(
    () => projectAgentMessages(selectedMessageEntities ?? [], selectedRun, selectedRunEvents ?? []),
    [selectedMessageEntities, selectedRun, selectedRunEvents],
  )
  const selectedQueuedTurnEdit = selected ? state.queued_turn_edits?.[selected.id] : undefined
  const selectedQueuedTurns = selected ? state.queued_turns?.[selected.id] ?? [] : []
  const selectedQueueState = selected ? state.queue_states?.[selected.id] : undefined
  const { recovery, profileConnection, connectSSHProfileBinding, profileConnectionPresentationKey, projectedDraftAttachments, resources, currentSlashCandidates, resourceContexts, notifyResourceBindingCompleted } = useAgentResourceWorkspace({ controller, notificationRef, tRef, gateway, selected, enabled, active, state, selectedQueueState, sshResources, readiness, backgroundActive, setDismissedProfileConnectionKey, remote, selectedQueuedTurnEdit, queuedTurnEditAttachments, getQueuedEditOwner, draftAttachments, slashCandidates, fileResources, desktopResources, slashCandidatesRef, sshResourcesRef, workflowResourcesReady, desktopResourcesReady, fileResourcesReady, sshProfileResourcesReady, sshResourcesReady })

  const approvalBypass = readiness?.mcp_policy?.approval_bypass
  const createReferenceSession = useCallback(async (request: AgentResourceReferenceLaunch) => {
    let selectionRevision = controller.getSnapshot().selection_intent_revision
    const pendingDraftSession = draftSessionCoordinator.acquire(selectionRevision)
    if (pendingDraftSession) {
      let attachmentSession: AgentSession | undefined
      try {
        attachmentSession = await pendingDraftSession.catch(() => undefined)
      } finally {
        draftSessionCoordinator.release(pendingDraftSession)
      }
      const current = controller.getSnapshot()
      // 附件会话自动选中仍属于原发起动作；等待期间的用户选择不得被后续创建覆盖。
      if (attachmentSession && current.selected_session_id === attachmentSession.id
        && current.selection_intent_revision === selectionRevision + 1) {
        selectionRevision = current.selection_intent_revision
      }
    }
    return createDraftSession(request.resource_reference, selectionRevision)
  }, [controller, createDraftSession, draftSessionCoordinator])
  const referenceImport = useAgentTerminalReferenceImport({
    intent: launchIntent ?? undefined,
    controller,
    active,
    ready: enabled && activeSetupReady && readiness?.status === 'ready' && workspaceInfrastructureReady && state.snapshot_complete,
    modelReady: newSessionModelRunnable,
    resourcesReady: { ssh_session: sshResourcesReady, file_profile: fileResourcesReady, desktop_session: desktopResourcesReady },
    resources,
    createSession: createReferenceSession,
    getOwnerId: (sessionId) => getQueuedEditOwner(sessionId) ?? 'draft',
    addReference: (sessionId, request, ownerId) => {
      if (ownerId !== 'draft' && committedQueuedTurnEditSessionIdsRef.current.has(sessionId)) {
        throw new Error('AGENT_TERMINAL_REFERENCE_EDIT_SAVING')
      }
      return (ownerId === 'draft' ? draftAttachments : queuedTurnEditAttachments)
        .addTerminalReference(sessionId, { text: request.text, origin: request.origin }, ownerId)
    },
    onHandled: onLaunchIntentHandled,
    onFocus: () => setComposerFocusKey((current) => current + 1),
  })
  const reference: AgentSurfaceModel['reference'] = active ? {
    job: referenceImport.current,
    resources: resources,
    onConfirm: referenceImport.confirm,
    onRetry: referenceImport.retry,
    onDismiss: referenceImport.dismiss,
    onOpenSettings: onOpenSettings,
  } : undefined
  const approvalPolicy = useMemo(() => activeSetupReady && approvalBypass !== undefined
    ? {
      status: 'ready' as const,
      mode: agentApprovalModeFromBypass(approvalBypass),
      ...(remote ? { readOnly: true } : {}),
    }
    : { status: 'unavailable' as const }, [activeSetupReady, approvalBypass, remote])

  const readinessView: AgentSurfaceModel['readiness'] = {
    readiness: readiness,
    loading: setupLoading || operationBusy.workspace,
    onRefresh: () => void hydrateActiveSetup(activeSetupEpochRef.current),
    remote: remote,
    onPrepare: remote || !setupGateway.setup ? undefined : () => void perform(async () => {
      if (!enabled || !active) return
      const epoch = activeSetupEpochRef.current
      activeSetupAbortRef.current?.abort()
      const requestAbort = new AbortController()
      activeSetupAbortRef.current = requestAbort
      try {
        const result = await setupGateway.setup!(requestAbort.signal)
        requestAbort.signal.throwIfAborted()
        const catalog = await loadAgentModelCatalog(setupGateway, requestAbort.signal)
        if (requestAbort.signal.aborted || activeSetupEpochRef.current !== epoch) return
        acceptSetupSnapshot(result, catalog.providers, catalog.models)
        markActiveSetupReady(epoch)
      } catch (error) {
        // 离页会撤销本次准备，迟到响应不再加载目录或更新当前页面。
        if (!requestAbort.signal.aborted) throw error
      } finally {
        if (activeSetupAbortRef.current === requestAbort) activeSetupAbortRef.current = null
      }
    }),
  }
  if (!enabled || !readiness || readiness.status !== 'ready' || !workspaceInfrastructureReady) {
    return renderSurface({ readiness: readinessView,
      onRefreshSetup: () => void hydrateActiveSetup(activeSetupEpochRef.current) })
  }

  const { resourceRunBlocked, resourceRecoveryBlocked, resourceConnectionBlocked, activeRun, selectedModel, selectedReasoningLevel, selectedModelRunnable, queuedTurnCounts, slashExecutionCurrent, slashAvailability, inspector } = projectAgentSurfaceStatus({ resourceContexts, recovery, profileConnection, selected, state, modelById, newSessionModelId, newSessionReasoningLevel, providerById, selectedQueuedTurns, slashExecutionSessionIds, activeSetupReady, workspaceInfrastructureReady, selectedQueuedTurnEdit, operationBusy, workflowResourcesReady, remote, desktopResourcesReady, readiness })

  const { executeSlashCommand } = createAgentSlashActions({ slashExecutionSessionIdsRef, setSlashExecutionSessionIds, modal, t, controller, slashAvailability, ensureDraftSession, notificationRef, tRef, remote, slashCandidatesRef, recovery, profileConnection, readiness, connectSSHProfileBinding, performResourceMutation, notifyResourceBindingCompleted, sshResourcesRef, draftSessionCoordinator, setDraftGroupId, setComposerFocusKey })

  const sessionActions = createAgentSessionActions({ workspaceInfrastructureReady, controller, setDraftGroupId, readiness, firstRunnableModelId, modelById, setDraftModelId, setDraftReasoningLevel, activeRun, workspaceSessions, management, draftAttachments, notificationRef, tRef, remote, perform, selected, providerById, newSessionReasoningLevel, selectedModel })

  const submissionActions = createAgentSubmissionActions({ activeSetupReady, workspaceInfrastructureReady, perform, controller, slashExecutionSessionIdsRef, resourceRunBlocked, selected, recovery, profileConnection, draftSessionCoordinator, newSessionModelId, modelById, providerById, t, draftGroupId, newSessionReasoningLevel, setDraftModelId, readiness, firstRunnableModelId, setDraftReasoningLevel, setDraftGroupId, draftAttachments, resourceContexts })

  const queueActions = createAgentQueueActions({ selected, workspaceInfrastructureReady, perform, slashExecutionSessionIdsRef, recovery, profileConnection, controller, draftAttachments, resourceContexts, committedQueuedTurnEditSessionIdsRef })

  const resourceActions = createAgentResourceActions({ selected, controller, readiness, connectSSHProfileBinding, performResourceMutation, recovery })

  const workspace: AgentSurfaceModel['workspace'] = {
    composerFocusKey: composerFocusKey,
    composerActive: active,
    sessions: workspaceSessions,
    session_management: {
      groups: state.session_groups,
      pendingIds: management.pendingIds,
      disabled: !state.snapshot_complete || state.phase === 'reconnecting',
      searchQuery: management.query,
      searchResults: searchSessions,
      searchLoading: management.searchLoading,
      searchError: management.searchError,
      onSearchQueryChange: management.setQuery,
      onSearchRetry: management.reloadSearch,
      onRename: async (id, title) => { await management.metadata(id, { title }) },
      onPin: async (id, pinned) => { await management.metadata(id, { pinned }) },
      onMoveToGroup: async (id, groupId, unpin) => {
        await management.metadata(id, { group_id: groupId ?? '', ...(unpin ? { pinned: false } : {}) })
      },
      onCreateGroup: management.createGroup,
      onRenameGroup: management.renameGroup,
      onDeleteGroup: management.deleteGroup,
      onMoveGroup: management.moveGroup,
      onMovePin: management.movePin,
      onMoveSession: management.moveSession,
      onOpenArchives: () => setArchivesOpen(true),
    },
    selected_session_id: state.selected_session_id,
    messages: workspaceMessages,
    models: workspaceModelOptions,
    selected_model_id: selected?.model_id ?? newSessionModelId,
    default_model_id: readiness.settings.default_model_id ?? firstRunnableModelId,
    selected_reasoning_level: selectedReasoningLevel,
    approval_policy: approvalPolicy,
    inspector: inspector,
    draft: state.drafts[selected?.id ?? 'new']?.text ?? '',
    draft_attachments: projectedDraftAttachments,
    queued_turns: selectedQueuedTurns,
    queued_turn_counts: queuedTurnCounts,
    queue_state: selectedQueueState,
    queued_turn_edit: selectedQueuedTurnEdit,
    supports_images: selectedRun && selectedRun.id === activeRun?.id
      ? selectedRun.model_snapshot.supports_images
      : selectedModel?.supports_images ?? false,
    model_runnable: selectedModelRunnable,
    show_turn_token_usage: readiness.settings.show_turn_token_usage,
    loading: state.phase === 'loading',
    busy: operationBusy.workspace,
    queue_busy: operationBusy.queue,
    stop_busy: operationBusy.stop,
    active_run: activeRun ? {
      session_id: activeRun.session_id,
      status: activeRun.status,
    } : undefined,
    run_blocked: !activeSetupReady || agentRunInteractionBlocked(
      activeRun?.id,
      selectedRun,
      state.runtime_status,
    ),
    resource_run_blocked: resourceRunBlocked,
    resource_contexts: resourceContexts,
    execution_blocked: !workspaceInfrastructureReady,
    resource_recovery_blocked: resourceRecoveryBlocked || resourceConnectionBlocked || slashExecutionCurrent,
    resource_recovery_disabled: !enabled || !state.snapshot_complete || Boolean(selected?.archived_at)
      || Boolean(activeRun && activeRun.session_id === selected?.id),
    slashCandidates: currentSlashCandidates,
    slashAvailability: slashAvailability,
    sshProfileAssociationMode: readiness?.settings.connect_ssh_profile_on_bind ? 'immediate' : 'on_demand',
    profileConnection: profileConnectionPresentationKey
      && profileConnectionPresentationKey === dismissedProfileConnectionKey
      ? undefined
      : profileConnection.state ? {
        operation: profileConnection.state.view?.operation,
        checking: profileConnection.state.checking,
        submitting: profileConnection.state.submitting,
        uncertain: profileConnection.state.uncertain,
        reconciling: profileConnection.state.reconciling,
        error_code: profileConnection.state.error_code,
      } : undefined,
    ...sessionActions,
    onOpenSettings: onOpenSettings ?? (() => undefined),
    onDraftChange: (value) => controller.updateDraft(selected?.id ?? 'new', value),
    onAttachFiles: (files) => {
      const selection = controller.getSnapshot()
      const sessionId = selection.selected_session_id
      if (!sessionId && !workspaceInfrastructureReady) return Promise.resolve()
      const ownerId = sessionId ? getQueuedEditOwner(sessionId) ?? 'draft' : 'draft'
      const attachments = ownerId === 'draft' ? draftAttachments : queuedTurnEditAttachments
      if (sessionId) return attachments.add(files, { sessionId, ownerId })
      return attachments.add(files, undefined, () => {
        const latest = controller.getSnapshot()
        return !latest.selected_session_id && latest.selection_intent_revision === selection.selection_intent_revision
      })
    },
    onRemoveAttachment: selected && selectedQueuedTurnEdit
      ? queuedTurnEditAttachments.remove
      : draftAttachments.remove,
    onRetryAttachment: selected && selectedQueuedTurnEdit
      ? queuedTurnEditAttachments.retry
      : draftAttachments.retry,
    onLoadAttachmentContent: loadAttachmentContent,
    onLoadToolImage: loadToolImage,
    onExecuteSlashCommand: executeSlashCommand,
    onCancelProfileConnection: async () => selected
      ? profileConnection.coordinator.cancel(selected.id)
      : false,
    onRetryProfileConnection: async () => {
      const latest = controller.getSnapshot().sessions.find(({ id }) => id === selected?.id)
      if (!latest) return false
      setDismissedProfileConnectionKey(undefined)
      return profileConnection.coordinator.retry(latest)
    },
    onDismissProfileConnection: () => {
      if (profileConnectionPresentationKey) {
        setDismissedProfileConnectionKey(profileConnectionPresentationKey)
      }
    },
    ...submissionActions,
    onStop: async () => { await perform(() => controller.stopActiveRun(), 'generic', 'stop') },
    onContextCompressionPendingChange: (enabled) => {
      if (!selected || !workspaceInfrastructureReady) return
      try {
        controller.setContextCompressionPending(selected.id, enabled)
      } catch {
        notifyError(notificationRef.current, tRef.current, undefined, 'generic', remote)
      }
    },
    onRetryContext: () => {
      if (selected) void controller.reloadContext(selected.id)
    },
    ...queueActions,
    onRetryUsage: () => {
      if (selected) void controller.reloadUsage(selected.id)
    },
    onApprovalModeChange: changeApprovalMode,
    ...resourceActions,
    onRemoveResourceBinding: async (kind) => {
      if (!selected) return false
      return performResourceMutation(
        selected.id,
        () => controller.removeResourceBinding(selected.id, selected.revision, kind),
      )
    },
  }
  const archive: AgentSurfaceModel['archive'] = {
    open: archivesOpen && enabled && active,
    groups: state.session_groups,
    pendingIds: management.pendingIds,
    sessions: archives.sessions,
    query: archives.query,
    listLoading: archives.listLoading,
    listError: archives.listError,
    selectedSession: archives.selectedSession,
    messages: archiveMessages,
    previewLoading: archives.previewLoading,
    previewError: archives.previewError,
    showTurnTokenUsage: readiness.settings.show_turn_token_usage,
    onClose: () => setArchivesOpen(false),
    onQueryChange: archives.setQuery,
    onSelect: archives.selectSession,
    onReload: archives.reload,
    onReloadPreview: archives.reloadPreview,
    onLoadAttachmentContent: loadAttachmentContent,
    onLoadToolImage: loadToolImage,
    onRestore: async (session) => {
      const selection = controller.getSnapshot()
      try {
        await management.metadata(session.id, { archived: false }, session)
        archives.removeSession(session.id)
        const current = controller.getSnapshot()
        if (current.selection_intent_revision === selection.selection_intent_revision
          && current.selected_session_id !== selection.selected_session_id) {
          controller.selectSession(selection.selected_session_id)
        }
      } catch (error) { archives.reload(); throw error }
    },
    onDelete: async (session) => {
      try {
        await management.perform([session.id], () => controller.deleteSession(session.id, session.revision))
        archives.removeSession(session.id)
      } catch (error) { archives.reload(); throw error }
    },
  }
  return renderSurface({
    reference, workspace, archive,
    warning: activeSetupFailed && syncWarningVisible ? 'setup' : state.error_code && syncWarningVisible ? state.phase === 'reconnecting' ? 'reconnecting' : 'degraded' : undefined,
    onRetry: () => { if (activeSetupFailed) void hydrateActiveSetup(activeSetupEpochRef.current); else void perform(() => controller.reload()) },
    onRefreshSetup: () => void hydrateActiveSetup(activeSetupEpochRef.current),
  })
}
