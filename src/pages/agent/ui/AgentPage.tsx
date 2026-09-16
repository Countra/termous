import { App as AntdApp, Alert } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isAgentModelRunnable,
  isAgentResourceRecoveryBlocking,
  agentResourceBindingKey,
  getAgentResourceBinding,
  getAgentResourceBindingBySlot,
  resourceBindingMatchesSource,
  resourceReference,
  type AgentResourceBinding,
  type AgentResourceState,
  type AgentFileResourceState,
  type AgentLaunchIntent,
  type AgentModel,
  type AgentModelProvider,
  type AgentResourceReference,
  type AgentReasoningLevel,
  type AgentReadiness,
  type AgentReferenceTargetsSnapshot,
  type AgentResourceReferenceLaunch,
  type AgentSession,
  type AgentSlashCandidate,
  type AgentSlashCandidateCatalog,
  type AgentSSHProfileResourceState,
  type AgentSSHResourceState,
} from '#entities/agent'
import { loadAgentModelCatalog, type AgentSetupGateway } from '#features/agent-setup'
import {
  AgentRuntimeStartError,
  AgentDraftSessionCoordinator,
  AgentWorkspaceController,
  useAgentDraftAttachments,
  useAgentArchives,
  useAgentSessionManagement,
  projectAgentReferenceTargets,
  useAgentTerminalReferenceImport,
  useAgentQueuedTurnEditOwners,
  useAgentResourceRecovery,
  useAgentResourceBindingConnection,
  isAgentResourceBindingConnectionBlocking,
  type AgentWorkspaceGateway,
} from '#features/agent-runtime'
import {
  agentApprovalModeFromBypass,
  agentApprovalModeToBypass,
  type AgentApprovalMode,
} from '#features/agent-approval-policy'
import { termousNotificationClassName } from '#shared/ui'
import {
  AgentWorkspace,
  AgentArchiveManager,
  type AgentWorkspaceInspectorState,
  type AgentWorkspaceResourceContext,
  type AgentWorkspaceSlashAvailability,
  type AgentWorkspaceSlashExecution,
} from '#widgets/agent-workspace'
import {
  agentRunInteractionBlocked,
  agentWorkspaceInfrastructureReady,
  latestSessionRun,
  projectAgentModelOptions,
  projectAgentMessages,
  projectAgentSessions,
  selectionAfterSessionRemoval,
} from '../model/agentWorkspaceProjection.ts'
import { resolveAgentModelReasoningLevel } from '../model/agentModelSelection.ts'
import { resolveAgentResourceError } from '../model/agentResourceError.ts'
import {
  compactDraftHasPayload,
  compactSlashDisabledReason,
  consumeSlashCaptureText,
  latestSlashCandidate,
  latestSlashMutationCandidate,
  sameSlashCandidateIdentity,
  slashCandidateMatchesBinding,
  slashCaptureMatches,
  slashCommandAvailability,
  slashDisabledReason,
} from '../model/agentSlashExecution.ts'
import { projectCurrentAgentSlashCandidates } from '../model/agentSlashProjection.ts'
import { AgentReadinessSurface } from './AgentReadinessSurface.tsx'
import { AgentTerminalReferenceImportNotice } from './AgentTerminalReferenceImportNotice.tsx'
import styles from './AgentPage.module.scss'

const noSSHResources: AgentSSHResourceState[] = []
const noSlashCandidates: AgentSlashCandidateCatalog = {
  session: { ssh: [], file: [] },
  profile: { ssh: [], file: [] },
}

export function AgentPage({
  gateway,
  setupGateway,
  sshResources = noSSHResources,
  sshResourcesReady = false,
  fileResources = [],
  fileResourcesReady = sshResourcesReady,
  sshProfileResourcesReady = fileResourcesReady,
  slashCandidates = noSlashCandidates,
  enabled,
  active,
  launchIntent,
  onLaunchIntentHandled,
  onRuntimeSummaryChange,
  onReferenceTargetsChange,
  onOpenSettings,
}: {
  gateway: AgentWorkspaceGateway
  setupGateway: AgentSetupGateway
  sshResources?: AgentSSHResourceState[]
  sshResourcesReady?: boolean
  sshProfileResourcesReady?: boolean
  fileResources?: AgentFileResourceState[]
  fileResourcesReady?: boolean
  slashCandidates?: AgentSlashCandidateCatalog
  enabled: boolean
  active: boolean
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
  const { notification, modal } = AntdApp.useApp()
  const controller = useMemo(() => new AgentWorkspaceController({ gateway }), [gateway])
  const draftSessionCoordinator = useMemo(() => new AgentDraftSessionCoordinator(), [])
  const getQueuedEditOwner = useAgentQueuedTurnEditOwners(controller)
  const [composerFocusKey, setComposerFocusKey] = useState(0)
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const management = useAgentSessionManagement(controller, gateway, state.sessions, enabled && active)
  const [archivesOpen, setArchivesOpen] = useState(false)
  const archives = useAgentArchives(gateway, archivesOpen && enabled && active, state.sessions)
  const [draftGroupId, setDraftGroupId] = useState<string>()
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)
  const [providers, setProviders] = useState<AgentModelProvider[]>([])
  const [models, setModels] = useState<AgentModel[]>([])
  const [setupLoading, setSetupLoading] = useState(true)
  const [operationBusy, setOperationBusy] = useState<AgentOperationBusy>(() => createOperationBusy())
  const [draftModelId, setDraftModelId] = useState<string>()
  const [draftReasoningLevel, setDraftReasoningLevel] = useState<AgentReasoningLevel>()
  const [dismissedProfileConnectionKey, setDismissedProfileConnectionKey] = useState<string>()
  const [slashExecutionSessionIds, setSlashExecutionSessionIds] = useState<ReadonlySet<string>>(() => new Set())
  const [activeSetupReadyEpoch, setActiveSetupReadyEpoch] = useState(0)
  const [activeSetupFailedEpoch, setActiveSetupFailedEpoch] = useState(0)
  const operationBusyRef = useRef<AgentOperationBusy>(createOperationBusy())
  const setupLoadRequestRef = useRef(0)
  const activeSetupEpochRef = useRef(0)
  const activeSetupReadyEpochRef = useRef(0)
  const activeSetupAbortRef = useRef<AbortController | null>(null)
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

  const acceptSetupSnapshot = useCallback((
    nextReadiness: AgentReadiness,
    nextProviders: AgentModelProvider[],
    nextModels: AgentModel[],
  ) => {
    const nextProvidersById = new Map(nextProviders.map((provider) => [provider.id, provider]))
    setReadiness(nextReadiness)
    setProviders(nextProviders)
    setModels(nextModels)
    setDraftModelId((current) => (
      current && nextModels.some((model) => model.id === current)
          ? current
          : nextReadiness.settings.default_model_id
          || nextModels.find((model) => (
            isAgentModelRunnable(model, nextProvidersById.get(model.provider_id))
          ))?.id
    ))
  }, [])

  const loadSetup = useCallback(async (
    signal?: AbortSignal,
    shouldAccept: () => boolean = () => true,
  ) => {
    const request = setupLoadRequestRef.current + 1
    setupLoadRequestRef.current = request
    setSetupLoading(true)
    try {
      const [nextReadiness, catalog] = await Promise.all([
        setupGateway.readiness(signal),
        loadAgentModelCatalog(setupGateway, signal),
      ])
      signal?.throwIfAborted()
      if (!shouldAccept()) return false
      acceptSetupSnapshot(nextReadiness, catalog.providers, catalog.models)
      const selectedSessionId = controller.getSnapshot().selected_session_id
      if (selectedSessionId) {
        try {
          await Promise.all([
            controller.reloadContext(selectedSessionId),
            controller.reloadUsage(selectedSessionId),
          ])
        } catch {
          if (!signal?.aborted) notifyError(notificationRef.current, tRef.current)
        }
      }
      signal?.throwIfAborted()
      return shouldAccept()
    } catch {
      if (!signal?.aborted) notifyError(notificationRef.current, tRef.current)
      return false
    } finally {
      if (setupLoadRequestRef.current === request) setSetupLoading(false)
    }
  }, [acceptSetupSnapshot, controller, setupGateway])

  const markActiveSetupReady = useCallback((epoch: number) => {
    if (epoch <= 0 || activeSetupEpochRef.current !== epoch) return
    activeSetupReadyEpochRef.current = epoch
    setActiveSetupReadyEpoch(epoch)
    setActiveSetupFailedEpoch(0)
  }, [])

  const hydrateActiveSetup = useCallback((epoch: number) => {
    activeSetupAbortRef.current?.abort()
    const controller = new AbortController()
    activeSetupAbortRef.current = controller
    activeSetupReadyEpochRef.current = 0
    setActiveSetupReadyEpoch(0)
    setActiveSetupFailedEpoch(0)
    return loadSetup(
      controller.signal,
      () => activeSetupEpochRef.current === epoch,
    ).then((accepted) => {
      if (controller.signal.aborted || activeSetupEpochRef.current !== epoch) return false
      if (accepted) markActiveSetupReady(epoch)
      else setActiveSetupFailedEpoch(epoch)
      return accepted
    })
  }, [loadSetup, markActiveSetupReady])

  useEffect(() => {
    if (!enabled) return
    controller.start()
    return () => controller.close()
  }, [controller, enabled])

  useEffect(() => {
    onRuntimeSummaryChange?.({
      agentRunCount: state.active_run_id ? 1 : 0,
      snapshotComplete: enabled && state.snapshot_complete,
    })
  }, [enabled, onRuntimeSummaryChange, state.active_run_id, state.snapshot_complete])

  useLayoutEffect(() => {
    if (!enabled || !active) return
    const epoch = activeSetupEpochRef.current + 1
    activeSetupEpochRef.current = epoch
    void hydrateActiveSetup(epoch)
    return () => {
      if (activeSetupEpochRef.current !== epoch) return
      activeSetupAbortRef.current?.abort()
      activeSetupAbortRef.current = null
      activeSetupReadyEpochRef.current = 0
    }
  }, [active, enabled, hydrateActiveSetup])

  const perform = useCallback(async (
    operation: () => Promise<unknown>,
    errorContext: 'generic' | 'resource' = 'generic',
    lane: AgentOperationLane = 'workspace',
  ) => {
    if (operationBusyRef.current[lane]) return false
    operationBusyRef.current = { ...operationBusyRef.current, [lane]: true }
    setOperationBusy(operationBusyRef.current)
    try {
      await operation()
      return true
    } catch (error) {
      notifyError(notificationRef.current, tRef.current, error, errorContext)
      return false
    } finally {
      operationBusyRef.current = { ...operationBusyRef.current, [lane]: false }
      setOperationBusy(operationBusyRef.current)
    }
  }, [])

  const performResourceMutation = useCallback(async (
    sessionId: string,
    operation: () => Promise<unknown>,
  ) => await perform(async () => {
    try {
      await operation()
    } catch (error) {
      if (resolveAgentResourceError(error).kind === 'revision_conflict') {
        try {
          await controller.reloadSession(sessionId)
        } catch {
          // Workspace 事件仍可恢复权威状态，保留原始冲突错误供用户判断。
        }
      }
      throw error
    }
  }, 'resource'), [controller, perform])

  const changeApprovalMode = useCallback(async (mode: AgentApprovalMode) => {
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
  }, [gateway, perform, readiness?.mcp_policy, setupGateway])

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
  const createDraftSession = useCallback(async (
    resourceReference?: AgentResourceReference,
    selectionRevision = controller.getSnapshot().selection_intent_revision,
    select = true,
  ) => {
    const modelId = newSessionModelId
    if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
    const model = modelById.get(modelId)
    if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
      throw new Error('AGENT_MODEL_UNAVAILABLE')
    }
    const session = await controller.createSession({
      title: tRef.current('agent.sessions.untitled'),
      group_id: resourceReference ? undefined : draftGroupId,
      auto_title_allowed: true,
      model_id: modelId,
      reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
      resource_reference: resourceReference,
    }, selectionRevision, select)
    const current = controller.getSnapshot()
    if (current.selected_session_id === session.id && current.selection_intent_revision === selectionRevision + 1
      && !resourceReference) setDraftGroupId(undefined)
    return session
  }, [controller, draftGroupId, modelById, newSessionModelId, newSessionReasoningLevel, providerById])

  const ensureDraftSession = useCallback((selectionRevision: number) => {
    return draftSessionCoordinator.ensure(
      selectionRevision,
      () => createDraftSession(undefined, selectionRevision, false),
    )
  }, [createDraftSession, draftSessionCoordinator])

  const ensureAttachmentSession = useCallback(async () => {
    const selection = controller.getSnapshot()
    if (selection.selected_session_id) return selection.selected_session_id
    const pendingSession = ensureDraftSession(selection.selection_intent_revision)
    let session: AgentSession
    try {
      session = await pendingSession
    } finally {
      draftSessionCoordinator.release(pendingSession)
    }
    const current = controller.getSnapshot()
    const ownsDraft = !current.selected_session_id
      && current.selection_intent_revision === selection.selection_intent_revision
    const newDraft = (ownsDraft ? current : selection).drafts.new?.text ?? ''
    // 同代草稿始终采用完成时内容；用户另开草稿后，迟到回执只保留原代快照。
    if (ownsDraft || newDraft && !current.drafts[session.id]) controller.updateDraft(session.id, newDraft)
    if (ownsDraft) {
      controller.updateDraft('new', '')
      controller.selectSession(session.id)
      setDraftGroupId(undefined)
    }
    return session.id
  }, [controller, draftSessionCoordinator, ensureDraftSession])

  const reportAttachmentError = useCallback((code: string) => {
    notificationRef.current.error({
      title: tRef.current('agent.attachments.failed'),
      description: tRef.current(`agent.attachments.error.${code}`, {
        defaultValue: tRef.current('agent.attachments.error.unknown'),
      }),
      className: termousNotificationClassName,
    })
  }, [])
  const loadAttachmentContent = useCallback(
    (attachment: import('#entities/agent').AgentAttachment, signal?: AbortSignal) => (
      gateway.attachmentContent(attachment.id, signal)
    ),
    [gateway],
  )
  const draftAttachments = useAgentDraftAttachments({
    gateway,
    ensureSession: ensureAttachmentSession,
    onError: reportAttachmentError,
    getOwnerId: () => 'draft',
  })
  const queuedTurnEditExistingSelections = useCallback((sessionId: string) => {
    const edit = controller.getSnapshot().queued_turn_edits[sessionId]
    const turn = controller.getSnapshot().queued_turns[sessionId]
      ?.find(({ id }) => id === edit?.turn_id)
    const retained = new Set(edit?.retained_attachment_ids ?? [])
    return (turn?.attachments ?? [])
      .filter(({ id }) => retained.has(id))
      .map(({ kind, size_bytes }) => ({ kind, size_bytes }))
  }, [controller])
  const queuedTurnEditAttachments = useAgentDraftAttachments({
    gateway,
    ensureSession: ensureAttachmentSession,
    onError: reportAttachmentError,
    existingSelections: queuedTurnEditExistingSelections,
    getOwnerId: (sessionId) => committedQueuedTurnEditSessionIdsRef.current.has(sessionId)
      ? undefined : getQueuedEditOwner(sessionId),
  })

  useEffect(() => {
    const current = new Map(Object.keys(state.queued_turn_edits ?? {}).flatMap((sessionId) => {
      const owner = getQueuedEditOwner(sessionId)
      return owner ? [[sessionId, owner] as const] : []
    }))
    for (const [sessionId, owner] of previousQueuedTurnEditSessionIdsRef.current) {
      if (current.get(sessionId) === owner) continue
      void queuedTurnEditAttachments.discardOwner(sessionId, owner, committedQueuedTurnEditSessionIdsRef.current.delete(sessionId))
    }
    previousQueuedTurnEditSessionIdsRef.current = current
  }, [getQueuedEditOwner, queuedTurnEditAttachments, state.queued_turn_edits])
  const activeSetupReady = active
    && activeSetupEpochRef.current > 0
    && activeSetupReadyEpoch === activeSetupEpochRef.current
    && activeSetupReadyEpochRef.current === activeSetupEpochRef.current
  const activeSetupFailed = active
    && activeSetupFailedEpoch > 0
    && activeSetupFailedEpoch === activeSetupEpochRef.current
  const selectedRun = useMemo(() => {
    if (!selected) return undefined
    const activeRun = state.active_run_id ? state.runs[state.active_run_id] : undefined
    return activeRun?.session_id === selected.id
      ? activeRun
      : latestSessionRun(selected.id, state.runs)
  }, [selected, state.active_run_id, state.runs])
  const selectedMessageEntities = selected ? state.messages[selected.id] : undefined
  const selectedRunEvents = selectedRun ? state.run_events[selectedRun.id] : undefined
  const workspaceMessages = useMemo(
    () => projectAgentMessages(selectedMessageEntities ?? [], selectedRun, selectedRunEvents ?? []),
    [selectedMessageEntities, selectedRun, selectedRunEvents],
  )
  const selectedQueuedTurnEdit = selected ? state.queued_turn_edits?.[selected.id] : undefined
  const selectedQueuedTurns = selected ? state.queued_turns?.[selected.id] ?? [] : []
  const selectedQueueState = selected ? state.queue_states?.[selected.id] : undefined
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
  }, [controller])
  const recovery = useAgentResourceRecovery(gateway, controller, selected,
    enabled && active && state.snapshot_complete, selectedQueueState?.revision, sshResources, readiness, notifyRecoveryCompleted)
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
  }, [controller])
  const notifyResourceBindingCompleted = useCallback((sessionId: string, candidate: AgentSlashCandidate) => {
    const current = controller.getSnapshot().sessions.find((session) => session.id === sessionId)
    const binding = current && getAgentResourceBindingBySlot(
      current.resource_bindings,
      candidate.resource_kind === 'ssh' ? 'ssh' : 'file',
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
  }, [controller])
  const connectionObservationRevision = `${selectedQueueState?.revision ?? 0}:${state.active_run_id ?? ''}:${sshResources
    .map((resource) => `${resource.session_id}:${resource.status}:${resource.started_at}`).join('|')}`
  const profileConnection = useAgentResourceBindingConnection(
    gateway,
    controller,
    selected,
    enabled && active && state.snapshot_complete,
    connectionObservationRevision,
    notifyConnectionCompleted,
  )
  const connectSSHProfileBinding = async (sessionId: string, sshProfileId: string) => {
    const latestSession = controller.getSnapshot().sessions.find((session) => session.id === sessionId)
    if (!latestSession || latestSession.archived_at) return false
    setDismissedProfileConnectionKey(undefined)
    const accepted = await profileConnection.coordinator.connect(latestSession, sshProfileId)
    if (!accepted) {
      notifyError(notificationRef.current, tRef.current,
        new Error(profileConnection.coordinator.getSnapshot()[latestSession.id]?.error_code
          ?? 'AGENT_RESOURCE_CONNECTION_FAILED'), 'resource')
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
    () => [...sshResources, ...sshProfileResources, ...fileResources],
    [sshResources, sshProfileResources, fileResources],
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
      (binding.kind === 'file_profile'
        ? fileResourcesReady
        : binding.kind === 'ssh_profile' ? sshProfileResourcesReady : sshResourcesReady)
        && state.snapshot_complete,
    )).map((context) => context.binding.kind === 'ssh_session' ? { ...context, recovery: recovery.state } : context),
    [selected?.resource_bindings, resources, sshResourcesReady, sshProfileResourcesReady,
      fileResourcesReady, state.snapshot_complete, recovery.state],
  )
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
    ready: enabled && activeSetupReady && workspaceInfrastructureReady && state.snapshot_complete,
    modelReady: newSessionModelRunnable,
    resourcesReady: { ssh_session: sshResourcesReady, file_profile: fileResourcesReady },
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
  const referenceNotice = active ? (
    <AgentTerminalReferenceImportNotice job={referenceImport.current} resources={resources}
      onConfirm={referenceImport.confirm} onRetry={referenceImport.retry} onDismiss={referenceImport.dismiss}
      onOpenSettings={onOpenSettings} />
  ) : null
  const approvalPolicy = useMemo(() => activeSetupReady && approvalBypass !== undefined
    ? {
        status: 'ready' as const,
        mode: agentApprovalModeFromBypass(approvalBypass),
      }
    : { status: 'unavailable' as const }, [activeSetupReady, approvalBypass])

  // 连接恢复不依赖 Skills 或 Worker；已有引用的工作区保留访问，任务入口另行锁定。
  const recoveryWorkspaceAvailable = state.snapshot_complete && state.sessions.some((session) => !session.archived_at
    && session.resource_bindings?.some((binding) => binding.kind === 'ssh_session'))
  const readinessSurface = <AgentReadinessSurface
    readiness={readiness}
    compact={enabled && Boolean(readiness) && recoveryWorkspaceAvailable}
    loading={setupLoading || operationBusy.workspace}
    onRefresh={() => void hydrateActiveSetup(activeSetupEpochRef.current)}
    onPrepare={() => void perform(async () => {
      if (!enabled || !active) return
      const epoch = activeSetupEpochRef.current
      activeSetupAbortRef.current?.abort()
      const requestAbort = new AbortController()
      activeSetupAbortRef.current = requestAbort
      try {
        const result = await setupGateway.setup(requestAbort.signal)
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
    })}
  />
  if (!enabled || !readiness || !workspaceInfrastructureReady && !recoveryWorkspaceAvailable) {
    return <div className={styles.page}>{referenceNotice}{readinessSurface}</div>
  }

  const resourceRunBlocked = resourceContexts.some(({ status }) => status !== 'ready')
  const resourceRecoveryBlocked = isAgentResourceRecoveryBlocking(recovery.state)
  const resourceConnectionBlocked = isAgentResourceBindingConnectionBlocking(profileConnection.state)
  const activeRun = state.active_run_id ? state.runs[state.active_run_id] : undefined
  const selectedModel = modelById.get(selected?.model_id ?? newSessionModelId ?? '')
  const selectedReasoningLevel = selected?.reasoning_level ?? newSessionReasoningLevel
  const selectedModelRunnable = Boolean(selectedModel && isAgentModelRunnable(
    selectedModel,
    providerById.get(selectedModel.provider_id),
  ) && selectedModel.supported_reasoning_levels.includes(selectedReasoningLevel))
  const selectedContext = selected ? state.session_contexts[selected.id] : undefined
  const contextSnapshot = selectedContext?.value
  const contextPending = contextSnapshot?.assessment === 'pending'
  const contextReference = contextSnapshot?.last_snapshot
  const referenceModel = contextReference ? modelById.get(contextReference.model_id) : undefined
  const selectedUsage = selected ? state.session_usages[selected.id] : undefined
  const queuedTurnCounts = Object.fromEntries(Object.entries(state.queued_turns ?? {}).map(([sessionId, turns]) => [
    sessionId,
    turns.filter(({ state: turnState }) => turnState === 'queued').length,
  ]))
  const usageSnapshot = selectedUsage?.value
  const selectedHasQueuedTurns = selectedQueuedTurns.some(({ state: turnState }) => turnState === 'queued')
  const selectedArchived = Boolean(selected?.archived_at)
  const slashExecutionCurrent = slashExecutionSessionIds.has(selected?.id ?? 'new')
  const resourceSlashEnabled = activeSetupReady
    && workspaceInfrastructureReady
    && state.snapshot_complete
    && !selectedArchived
    && !activeRun
    && !selectedQueuedTurnEdit
    && !selectedHasQueuedTurns
    && !operationBusy.workspace
    && !slashExecutionCurrent
  const sshSlashEnabled = resourceSlashEnabled
    && !resourceRecoveryBlocked
    && !resourceConnectionBlocked
  const resourceSlashDisabledReason = slashDisabledReason({
    archived: selectedArchived,
    activeRun: Boolean(activeRun),
    editing: Boolean(selectedQueuedTurnEdit),
    busy: operationBusy.workspace || slashExecutionCurrent,
    queued: selectedHasQueuedTurns,
    connection: false,
  })
  const sshSlashDisabledReason = slashDisabledReason({
    archived: selectedArchived,
    activeRun: Boolean(activeRun),
    editing: Boolean(selectedQueuedTurnEdit),
    busy: operationBusy.workspace || slashExecutionCurrent,
    queued: selectedHasQueuedTurns,
    connection: resourceConnectionBlocked || resourceRecoveryBlocked,
  })
  const compactSlashEnabled = activeSetupReady
    && workspaceInfrastructureReady
    && state.snapshot_complete
    && !selectedArchived
    && !activeRun
    && !selectedQueuedTurnEdit
    && !operationBusy.workspace
    && !slashExecutionCurrent
    && contextSnapshot?.compression_status !== 'unavailable'
    && (Boolean(selected) || compactDraftHasPayload(state.drafts.new?.text ?? ''))
  const slashAvailability: AgentWorkspaceSlashAvailability = {
    session: {
      ...slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      resource_kinds: {
        ssh: slashCommandAvailability(sshSlashEnabled, sshSlashDisabledReason),
        file: slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      },
    },
    profile: {
      ...slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      resource_kinds: {
        ssh: slashCommandAvailability(sshSlashEnabled, sshSlashDisabledReason),
        file: slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      },
    },
    compact: slashCommandAvailability(compactSlashEnabled,
      compactSlashDisabledReason({
        archived: selectedArchived,
        selected: Boolean(selected),
        draft: state.drafts.new?.text ?? '',
        activeRun: Boolean(activeRun),
        editing: Boolean(selectedQueuedTurnEdit),
        busy: operationBusy.workspace || slashExecutionCurrent,
        unavailable: contextSnapshot?.compression_status === 'unavailable',
      })),
  }
  const inspector: AgentWorkspaceInspectorState = {
    context: {
      phase: selected ? selectedContext?.phase ?? 'idle' : 'unavailable',
      has_snapshot: Boolean(contextSnapshot),
      used_tokens: contextSnapshot?.estimated_tokens ?? 0,
      context_window_tokens: contextPending
        ? selectedModel?.effective_context_window_tokens ?? contextSnapshot?.context_window_tokens ?? 0
        : contextSnapshot?.context_window_tokens ?? 0,
      estimated: contextSnapshot?.estimated ?? true,
      warning: contextSnapshot?.warning ?? false,
      compression_available: contextSnapshot?.compression_available ?? false,
      compression_pending: selectedContext?.compression_pending ?? false,
      assessment: contextSnapshot?.assessment,
      basis: contextSnapshot?.basis,
      compression_status: contextSnapshot?.compression_status,
      last_snapshot: contextReference ? {
        ...contextReference,
        model_name: contextReference.model_name === contextReference.model_id
          ? referenceModel?.display_name ?? contextReference.model_name : contextReference.model_name,
      } : undefined,
      checkpoint: contextSnapshot?.checkpoint,
      error_code: selectedContext?.error_code,
    },
    usage: {
      phase: selected ? selectedUsage?.phase ?? 'idle' : 'unavailable',
      has_snapshot: Boolean(usageSnapshot),
      run_count: usageSnapshot?.run_count ?? 0,
      input_tokens: usageSnapshot?.input_tokens ?? 0,
      output_tokens: usageSnapshot?.output_tokens ?? 0,
      cache_read_tokens: usageSnapshot?.cache_read_tokens ?? 0,
      cache_write_tokens: usageSnapshot?.cache_write_tokens ?? 0,
      reasoning_tokens: usageSnapshot?.reasoning_tokens ?? 0,
      total_tokens: usageSnapshot?.total_tokens ?? 0,
      estimated: usageSnapshot?.estimated ?? false,
      updated_at: usageSnapshot?.updated_at,
      error_code: selectedUsage?.error_code,
    },
    skills: [],
    mcp: {
      connection: projectMcpConnection(Boolean(state.active_run_id), state.runtime_status?.state),
      scope_count: readiness.mcp_policy?.scope_count ?? 0,
    },
  }

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
    if (!commandAvailability.enabled
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
        notifyError(notificationRef.current, tRef.current, error)
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
          candidate.resource_kind === 'ssh' ? 'ssh' : 'file',
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
          candidate.resource_kind === 'ssh' ? 'ssh' : 'file',
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
          const reference: AgentResourceReference = currentCandidate.kind === 'ssh_session'
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
              currentCandidate.resource_kind === 'ssh' ? 'ssh' : 'file',
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
  return (
    <div className={styles.page}>
      {referenceNotice}
      {!workspaceInfrastructureReady ? readinessSurface : activeSetupFailed ? (
        <Alert
          className={styles.alert}
          type="warning"
          showIcon
          title={t('agent.error.degraded')}
          description={t('agent.error.degradedDescription')}
          action={(
            <button
              type="button"
              disabled={setupLoading}
              onClick={() => void hydrateActiveSetup(activeSetupEpochRef.current)}
            >
              {t('app.retry')}
            </button>
          )}
        />
      ) : state.error_code ? (
        <Alert
          className={styles.alert}
          type="warning"
          showIcon
          title={t(state.phase === 'reconnecting'
            ? 'agent.error.reconnecting'
            : 'agent.error.degraded')}
          description={t(state.phase === 'reconnecting'
            ? 'agent.error.reconnectingDescription'
            : 'agent.error.degradedDescription')}
          action={<button type="button" onClick={() => void perform(() => controller.reload())}>{t('app.retry')}</button>}
        />
      ) : null}
      <AgentWorkspace
        composerFocusKey={composerFocusKey}
        composerActive={active}
        sessions={workspaceSessions}
        session_management={{
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
        }}
        selected_session_id={state.selected_session_id}
        messages={workspaceMessages}
        models={workspaceModelOptions}
        selected_model_id={selected?.model_id ?? newSessionModelId}
        default_model_id={readiness.settings.default_model_id ?? firstRunnableModelId}
        selected_reasoning_level={selectedReasoningLevel}
        approval_policy={approvalPolicy}
        inspector={inspector}
        draft={state.drafts[selected?.id ?? 'new']?.text ?? ''}
        draft_attachments={projectedDraftAttachments}
        queued_turns={selectedQueuedTurns}
        queued_turn_counts={queuedTurnCounts}
        queue_state={selectedQueueState}
        queued_turn_edit={selectedQueuedTurnEdit}
        supports_images={selectedRun && selectedRun.id === activeRun?.id
          ? selectedRun.model_snapshot.supports_images
          : selectedModel?.supports_images ?? false}
        model_runnable={selectedModelRunnable}
        show_turn_token_usage={readiness.settings.show_turn_token_usage}
        loading={state.phase === 'loading'}
        busy={operationBusy.workspace}
        queue_busy={operationBusy.queue}
        stop_busy={operationBusy.stop}
        active_run={activeRun ? {
          session_id: activeRun.session_id,
          status: activeRun.status,
        } : undefined}
        run_blocked={!activeSetupReady || agentRunInteractionBlocked(
          state.active_run_id,
          selectedRun,
          state.runtime_status,
        )}
        resource_run_blocked={resourceRunBlocked}
        resource_contexts={resourceContexts}
        execution_blocked={!workspaceInfrastructureReady}
        resource_recovery_blocked={resourceRecoveryBlocked || resourceConnectionBlocked || slashExecutionCurrent}
        resource_recovery_disabled={!enabled || !state.snapshot_complete || Boolean(selected?.archived_at)
          || Boolean(activeRun && activeRun.session_id === selected?.id)}
        slashCandidates={currentSlashCandidates}
        slashAvailability={slashAvailability}
        sshProfileAssociationMode={readiness?.settings.connect_ssh_profile_on_bind ? 'immediate' : 'on_demand'}
        profileConnection={profileConnectionPresentationKey
          && profileConnectionPresentationKey === dismissedProfileConnectionKey
          ? undefined
          : profileConnection.state ? {
              operation: profileConnection.state.view?.operation,
              checking: profileConnection.state.checking,
              submitting: profileConnection.state.submitting,
              uncertain: profileConnection.state.uncertain,
              reconciling: profileConnection.state.reconciling,
              error_code: profileConnection.state.error_code,
            } : undefined}
        onCreateSession={(groupId) => {
          if (!workspaceInfrastructureReady) return
          controller.selectSession(undefined)
          setDraftGroupId(groupId)
          const modelId = readiness.settings.default_model_id ?? firstRunnableModelId
          const model = modelId ? modelById.get(modelId) : undefined
          setDraftModelId(modelId)
          setDraftReasoningLevel(model?.effective_default_reasoning_level ?? 'off')
        }}
        onSelectSession={(sessionId) => controller.selectSession(sessionId)}
        onReturnToActiveRun={() => {
          if (activeRun) controller.selectSession(activeRun.session_id)
        }}
        onArchiveSession={(sessionId) => void (async () => {
          const selection = controller.getSnapshot()
          const nextSessionId = selectionAfterSessionRemoval(workspaceSessions, sessionId)
          await management.metadata(sessionId, { archived: true })
          await draftAttachments.discard(sessionId)
          if (
            selection.selected_session_id === sessionId
            && controller.getSnapshot().selection_intent_revision === selection.selection_intent_revision
          ) {
            controller.selectSession(nextSessionId)
          }
        })().catch((error: unknown) => notifyError(notificationRef.current, tRef.current, error))}
        onDeleteSession={(sessionId) => void management.perform([sessionId], async () => {
          const session = requireSession(controller.getSnapshot().sessions, sessionId)
          await controller.deleteSession(sessionId, session.revision)
          draftAttachments.clear(sessionId)
        }).catch((error: unknown) => notifyError(notificationRef.current, tRef.current, error))}
        onModelChange={(modelId) => void perform(async () => {
          if (!selected) {
            const model = modelById.get(modelId)
            if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
              throw new Error('AGENT_MODEL_UNAVAILABLE')
            }
            setDraftReasoningLevel((current) => resolveAgentModelReasoningLevel(
              model,
              current ?? newSessionReasoningLevel,
            ))
            setDraftModelId(modelId)
            return
          }
          const model = modelById.get(modelId)
          if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
            throw new Error('AGENT_MODEL_UNAVAILABLE')
          }
          await controller.updateSession(selected.id, {
            ...updateInput(selected, false),
            model_id: modelId,
            reasoning_level: resolveAgentModelReasoningLevel(model, selected.reasoning_level),
          })
        })}
        onReasoningChange={(reasoningLevel) => void perform(async () => {
          const model = selectedModel
          if (!model || !model.supported_reasoning_levels.includes(reasoningLevel)) {
            throw new Error('AGENT_REASONING_LEVEL_UNSUPPORTED')
          }
          if (!selected) {
            setDraftReasoningLevel(reasoningLevel)
            return
          }
          await controller.updateSession(selected.id, {
            ...updateInput(selected, false),
            reasoning_level: reasoningLevel,
          })
        })}
        onResetResponseOptions={() => void perform(async () => {
          const modelId = readiness.settings.default_model_id ?? firstRunnableModelId
          const model = modelId ? modelById.get(modelId) : undefined
          if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
            throw new Error('AGENT_DEFAULT_MODEL_MISSING')
          }
          const reasoningLevel = resolveAgentModelReasoningLevel(
            model,
            model.effective_default_reasoning_level,
          )
          if (!selected) {
            setDraftModelId(model.id)
            setDraftReasoningLevel(reasoningLevel)
            return
          }
          await controller.updateSession(selected.id, {
            ...updateInput(selected, false),
            model_id: model.id,
            reasoning_level: reasoningLevel,
          })
        })}
        onOpenSettings={onOpenSettings ?? (() => undefined)}
        onDraftChange={(value) => controller.updateDraft(selected?.id ?? 'new', value)}
        onAttachFiles={(files) => {
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
        }}
        onRemoveAttachment={selected && selectedQueuedTurnEdit
          ? queuedTurnEditAttachments.remove
          : draftAttachments.remove}
        onRetryAttachment={selected && selectedQueuedTurnEdit
          ? queuedTurnEditAttachments.retry
          : draftAttachments.retry}
        onLoadAttachmentContent={loadAttachmentContent}
        onExecuteSlashCommand={executeSlashCommand}
        onCancelProfileConnection={async () => selected
          ? profileConnection.coordinator.cancel(selected.id)
          : false}
        onRetryProfileConnection={async () => {
          const latest = controller.getSnapshot().sessions.find(({ id }) => id === selected?.id)
          if (!latest) return false
          setDismissedProfileConnectionKey(undefined)
          return profileConnection.coordinator.retry(latest)
        }}
        onDismissProfileConnection={() => {
          if (profileConnectionPresentationKey) {
            setDismissedProfileConnectionKey(profileConnectionPresentationKey)
          }
        }}
        onSend={async (message, attachmentIds) => {
          if (!activeSetupReady || !workspaceInfrastructureReady) return
          await perform(async () => {
            const submissionOwner = controller.getSnapshot().selected_session_id ?? 'new'
            if (slashExecutionSessionIdsRef.current.has(submissionOwner)) {
              throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            }
            if (resourceRunBlocked
              || isAgentResourceRecoveryBlocking(selected ? recovery.coordinator.getSnapshot()[selected.id] : undefined)
              || isAgentResourceBindingConnectionBlocking(selected
                ? profileConnection.coordinator.getSnapshot()[selected.id]
                : undefined)) throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            let targetSession = selected
            if (!targetSession) {
              const selectionRevision = controller.getSnapshot().selection_intent_revision
              const pendingSession = draftSessionCoordinator.acquire(selectionRevision)
              if (pendingSession) {
                try {
                  targetSession = await pendingSession
                } finally {
                  draftSessionCoordinator.release(pendingSession)
                }
              } else {
                const modelId = newSessionModelId
                if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
                const model = modelById.get(modelId)
                if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
                  throw new Error('AGENT_MODEL_UNAVAILABLE')
                }
                targetSession = await controller.createSession({
                  title: createSessionTitle(message, t('agent.sessions.untitled')),
                  group_id: draftGroupId,
                  model_id: modelId,
                  reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
                })
              }
              controller.updateDraft(targetSession.id, message)
              const current = controller.getSnapshot()
              if (current.selected_session_id === targetSession.id
                && current.selection_intent_revision === selectionRevision + 1) {
                controller.updateDraft('new', '')
                setDraftModelId(readiness.settings.default_model_id
                  || firstRunnableModelId)
                setDraftReasoningLevel(undefined)
                setDraftGroupId(undefined)
              } else if (!current.selected_session_id && current.selection_intent_revision === selectionRevision) {
                controller.updateDraft('new', '')
                controller.selectSession(targetSession.id)
                setDraftModelId(readiness.settings.default_model_id
                  || firstRunnableModelId)
                setDraftReasoningLevel(undefined)
                setDraftGroupId(undefined)
              }
            }
            const targetSessionId = targetSession.id
            const clearCommittedDraft = () => {
              draftAttachments.clearCommitted(targetSessionId, attachmentIds ?? [])
            }
            try {
              await controller.startRun(targetSessionId, message, attachmentIds)
            } catch (error) {
              if (
                error instanceof AgentRuntimeStartError
                && error.run.session_id === targetSessionId
              ) {
                clearCommittedDraft()
              }
              throw error
            }
            clearCommittedDraft()
          }, resourceContexts.length ? 'resource' : 'generic')
        }}
        onStop={async () => { await perform(() => controller.stopActiveRun(), 'generic', 'stop') }}
        onContextCompressionPendingChange={(enabled) => {
          if (!selected || !workspaceInfrastructureReady) return
          try {
            controller.setContextCompressionPending(selected.id, enabled)
          } catch {
            notifyError(notificationRef.current, tRef.current)
          }
        }}
        onRetryContext={() => {
          if (selected) void controller.reloadContext(selected.id)
        }}
        onQueueTurn={async (message, attachmentIds) => {
          if (!selected || !workspaceInfrastructureReady) return
          await perform(async () => {
            if (slashExecutionSessionIdsRef.current.has(selected.id)) {
              throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            }
            if (isAgentResourceRecoveryBlocking(recovery.coordinator.getSnapshot()[selected.id])
              || isAgentResourceBindingConnectionBlocking(profileConnection.coordinator.getSnapshot()[selected.id])) {
              throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            }
            const submittedDraft = controller.getSnapshot().drafts[selected.id]
            await controller.enqueueTurn(selected.id, message, attachmentIds)
            if (controller.getSnapshot().drafts[selected.id] === submittedDraft) {
              controller.updateDraft(selected.id, '')
            }
            draftAttachments.clearCommitted(selected.id, attachmentIds ?? [])
          }, resourceContexts.length ? 'resource' : 'generic', 'queue')
        }}
        onBeginQueuedTurnEdit={async (turnId) => {
          if (selected) await perform(
            () => controller.beginQueuedTurnEdit(selected.id, turnId),
            'generic',
            'queue',
          )
        }}
        onQueuedTurnEditChange={(value) => {
          if (selected) controller.updateQueuedTurnEditDraft(selected.id, value)
        }}
        onRemoveQueuedTurnEditAttachment={(attachmentId) => {
          if (selected) controller.removeQueuedTurnEditAttachment(selected.id, attachmentId)
        }}
        onSaveQueuedTurnEdit={async (attachmentIds) => {
          if (!selected) return
          const edit = controller.getSnapshot().queued_turn_edits[selected.id]
          const retainedAttachmentIds = edit?.retained_attachment_ids ?? []
          await perform(async () => {
            committedQueuedTurnEditSessionIdsRef.current.add(selected.id)
            try {
              await controller.saveQueuedTurnEdit(selected.id, [...retainedAttachmentIds, ...attachmentIds])
            } catch (error) {
              committedQueuedTurnEditSessionIdsRef.current.delete(selected.id)
              throw error
            }
          }, 'generic', 'queue')
        }}
        onCancelQueuedTurnEdit={async () => {
          if (selected) {
            await perform(() => controller.cancelQueuedTurnEdit(selected.id), 'generic', 'queue')
          }
        }}
        onDeleteQueuedTurn={async (turnId) => {
          if (selected) await perform(
            () => controller.deleteQueuedTurn(selected.id, turnId),
            'generic',
            'queue',
          )
        }}
        onMoveQueuedTurn={async (turnId, targetTurnId, placement) => {
          if (!selected) return false
          return await perform(() => (
            controller.moveQueuedTurn(selected.id, turnId, targetTurnId, placement)
          ), 'generic', 'queue')
        }}
        onSteerQueuedTurn={async (turnId) => {
          if (selected && workspaceInfrastructureReady) await perform(
            () => controller.steerQueuedTurn(selected.id, turnId),
            'generic',
            'queue',
          )
        }}
        onResumeQueue={async () => {
          if (selected && workspaceInfrastructureReady
            && !slashExecutionSessionIdsRef.current.has(selected.id)
            && !isAgentResourceRecoveryBlocking(recovery.coordinator.getSnapshot()[selected.id])
            && !isAgentResourceBindingConnectionBlocking(profileConnection.coordinator.getSnapshot()[selected.id])) {
            await perform(() => controller.resumeQueue(selected.id), 'generic', 'queue')
          }
        }}
        onRetryUsage={() => {
          if (selected) void controller.reloadUsage(selected.id)
        }}
        onApprovalModeChange={changeApprovalMode}
        onReplaceResourceBinding={async (reference) => {
          if (!selected) return false
          const latestSession = controller.getSnapshot().sessions.find((session) => session.id === selected.id)
          if (!latestSession || latestSession.archived_at) return false
          if (reference.kind === 'ssh_profile' && readiness.settings.connect_ssh_profile_on_bind) {
            return connectSSHProfileBinding(latestSession.id, reference.ssh_profile_id)
          }
          return await performResourceMutation(latestSession.id, async () => {
            await controller.replaceResourceBinding(latestSession.id, {
              ...reference,
              expected_revision: latestSession.revision,
            })
          })
        }}
        onRecoverResourceBinding={async () => {
          const current = controller.getSnapshot().sessions.find(({ id }) => id === selected?.id)
          if (!current) return false
          const accepted = await recovery.coordinator.recover(current)
          if (!accepted && recovery.coordinator.getSnapshot()[current.id]?.error_code === 'AGENT_REVISION_CONFLICT') {
            try {
              await controller.reloadSession(current.id)
            } catch {
              // 保留原始冲突诊断，后续工作区事件或用户重试负责恢复权威版本。
            }
          }
          return accepted
        }}
        onCancelResourceRecovery={async () => selected ? recovery.coordinator.cancel(selected.id) : false}
        onRemoveResourceBinding={async (kind) => {
          if (!selected) return false
          return performResourceMutation(
            selected.id,
            () => controller.removeResourceBinding(selected.id, selected.revision, kind),
          )
        }}
      />
      <AgentArchiveManager
        open={archivesOpen && enabled && active}
        groups={state.session_groups}
        pendingIds={management.pendingIds}
        sessions={archives.sessions}
        query={archives.query}
        listLoading={archives.listLoading}
        listError={archives.listError}
        selectedSession={archives.selectedSession}
        messages={archiveMessages}
        previewLoading={archives.previewLoading}
        previewError={archives.previewError}
        showTurnTokenUsage={readiness.settings.show_turn_token_usage}
        onClose={() => setArchivesOpen(false)}
        onQueryChange={archives.setQuery}
        onSelect={archives.selectSession}
        onReload={archives.reload}
        onReloadPreview={archives.reloadPreview}
        onLoadAttachmentContent={loadAttachmentContent}
        onRestore={async (session) => {
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
        }}
        onDelete={async (session) => {
          try {
            await management.perform([session.id], () => controller.deleteSession(session.id, session.revision))
            archives.removeSession(session.id)
          } catch (error) { archives.reload(); throw error }
        }}
      />
    </div>
  )
}

type AgentOperationLane = 'workspace' | 'queue' | 'stop'

interface AgentOperationBusy {
  workspace: boolean
  queue: boolean
  stop: boolean
}

function createOperationBusy(): AgentOperationBusy {
  return { workspace: false, queue: false, stop: false }
}

function updateInput(session: AgentSession, archived: boolean) {
  return {
    title: session.title,
    model_id: session.model_id,
    reasoning_level: session.reasoning_level,
    archived,
    expected_revision: session.revision,
  }
}

function projectResourceContext(
  binding: AgentResourceBinding,
  resources: AgentResourceState[],
  snapshotReady: boolean,
): AgentWorkspaceResourceContext {
  const live = resources.find((source) => resourceBindingMatchesSource(binding, source))
  const identityMatches = Boolean(live)
  return {
    binding,
    status: !snapshotReady ? 'checking' : !live ? 'stale' : live.status,
    ...(identityMatches ? { live_resource: live } : {}),
    candidates: resources
      .filter((source) => source.status === 'ready' && resourceReference(source).kind === binding.kind)
      .sort((left, right) => 'started_at' in left && 'started_at' in right
        ? Date.parse(right.started_at) - Date.parse(left.started_at) : (left.host_name ?? '').localeCompare(right.host_name ?? '')),
  }
}

function slashCandidateMatchesExpectedBinding(
  candidate: AgentSlashCandidate,
  binding: AgentResourceBinding | undefined,
) {
  return candidate.kind === 'ssh_profile'
    ? binding?.kind === 'ssh_profile' && slashCandidateMatchesBinding(candidate, binding)
    : slashCandidateMatchesBinding(candidate, binding)
}

function slashBindingLabel(binding: AgentResourceBinding, catalog: AgentSlashCandidateCatalog) {
  const profileName = binding.kind === 'file_profile'
    ? binding.file_access_profile_name
    : binding.kind === 'ssh_profile'
      ? binding.ssh_profile_name
      : catalog.profile.ssh.find((candidate) => (
          candidate.host_id === binding.host_id
          && candidate.ssh_profile_id === binding.ssh_profile_id
        ))?.profile_name ?? shortResourceID(binding.ssh_profile_id)
  return `${binding.host_name} / ${profileName}`
}

function slashCandidateLabel(candidate: AgentSlashCandidate) {
  return `${candidate.host_name} / ${candidate.profile_name}`
}

function shortResourceID(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`
}

function requireSession(sessions: AgentSession[], id: string) {
  const session = sessions.find((item) => item.id === id)
  if (!session) throw new Error('AGENT_SESSION_NOT_FOUND')
  return session
}

function createSessionTitle(prompt: string, fallback: string) {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || fallback
  return Array.from(firstLine).slice(0, 48).join('')
}

function projectMcpConnection(
  hasActiveRun: boolean,
  runtimeState: 'offline' | 'ready' | 'starting' | 'running' | 'stopping' | undefined,
): AgentWorkspaceInspectorState['mcp']['connection'] {
  if (!hasActiveRun) return runtimeState === 'offline' ? 'disconnected' : 'on_demand'
  return runtimeState === 'running' || runtimeState === 'stopping'
    ? 'connected'
    : runtimeState === 'starting' || runtimeState === 'ready'
      ? 'connecting'
      : 'disconnected'
}

function notifyError(
  notification: ReturnType<typeof AntdApp.useApp>['notification'],
  t: (key: string) => string,
  error?: unknown,
  context: 'generic' | 'resource' = 'generic',
) {
  if (context === 'resource') {
    const resourceError = resolveAgentResourceError(error)
    if (resourceError.kind === 'unavailable') {
      notification.error({
        title: t(resourceError.resourceKind === 'file_profile' ? 'agent.fileResource.errorTitle' : 'agent.resource.error.unavailableTitle'),
        description: t(resourceError.resourceKind === 'file_profile' ? 'agent.fileResource.hint.stale' : `agent.resource.error.reason.${resourceError.reason}`),
        className: termousNotificationClassName,
      })
      return
    }
    if (resourceError.kind === 'revision_conflict') {
      notification.warning({
        title: t('agent.resource.error.conflictTitle'),
        description: t('agent.resource.error.conflictDescription'),
        className: termousNotificationClassName,
      })
      return
    }
    if (resourceError.kind === 'run_conflict') {
      notification.warning({
        title: t('agent.resource.error.activeRunTitle'),
        description: t('agent.resource.error.activeRunDescription'),
        className: termousNotificationClassName,
      })
      return
    }
  }
  notification.error({
    title: t('agent.error.operation'),
    description: t('agent.error.operationDescription'),
    className: termousNotificationClassName,
  })
}
