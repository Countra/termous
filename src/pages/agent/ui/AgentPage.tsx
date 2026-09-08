import { App as AntdApp, Alert } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isAgentModelRunnable,
  type AgentLaunchIntent,
  type AgentModel,
  type AgentModelProvider,
  type AgentResourceReference,
  type AgentReasoningLevel,
  type AgentReadiness,
  type AgentReferenceTargetsSnapshot,
  type AgentTerminalReferenceLaunch,
  type AgentSession,
  type AgentSSHResourceState,
  type AgentSourceContext,
} from '#entities/agent'
import { loadAgentModelCatalog, type AgentSetupGateway } from '#features/agent-setup'
import {
  AgentRuntimeStartError,
  AgentWorkspaceController,
  useAgentDraftAttachments,
  useAgentArchives,
  useAgentSessionManagement,
  projectAgentReferenceTargets,
  useAgentTerminalReferenceImport,
  useAgentQueuedTurnEditOwners,
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
import { AgentReadinessSurface } from './AgentReadinessSurface.tsx'
import { AgentTerminalReferenceImportNotice } from './AgentTerminalReferenceImportNotice.tsx'
import styles from './AgentPage.module.scss'

export function AgentPage({
  gateway,
  setupGateway,
  sshResources = [],
  sshResourcesReady = false,
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
  const { notification } = AntdApp.useApp()
  const controller = useMemo(() => new AgentWorkspaceController({ gateway }), [gateway])
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
  const [draftSourceContexts, setDraftSourceContexts] = useState<Record<string, AgentSourceContext>>({})
  const [activeSetupReadyEpoch, setActiveSetupReadyEpoch] = useState(0)
  const [activeSetupFailedEpoch, setActiveSetupFailedEpoch] = useState(0)
  const operationBusyRef = useRef<AgentOperationBusy>(createOperationBusy())
  const attachmentDraftSessionPromiseRef = useRef<Promise<AgentSession> | null>(null)
  const handledLaunchIntentRef = useRef(0)
  const setupLoadRequestRef = useRef(0)
  const activeSetupEpochRef = useRef(0)
  const activeSetupReadyEpochRef = useRef(0)
  const activeSetupAbortRef = useRef<AbortController | null>(null)
  const notificationRef = useRef(notification)
  const tRef = useRef(t)
  const previousQueuedTurnEditSessionIdsRef = useRef(new Map<string, string>())
  const previousReferenceTargetsRef = useRef('')
  const committedQueuedTurnEditSessionIdsRef = useRef(new Set<string>())
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
    const updated = await perform(async () => {
      try {
        const next = await gateway.updateMcpPolicy({
          approval_bypass: agentApprovalModeToBypass(mode),
          sync_scopes: false,
          expected_revision: policy.revision,
        })
        setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
      } catch (error) {
        const epoch = activeSetupEpochRef.current
        try {
          const nextReadiness = await setupGateway.readiness()
          if (activeSetupEpochRef.current === epoch) setReadiness(nextReadiness)
        } catch {
          // 保留原始策略更新错误；后续刷新仍会重新获取权威状态。
        }
        throw error
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
    sourceContext?: AgentSourceContext,
    resourceReference?: AgentResourceReference,
    automaticTitle = false,
  ) => {
    const modelId = newSessionModelId
    if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
    const model = modelById.get(modelId)
    if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
      throw new Error('AGENT_MODEL_UNAVAILABLE')
    }
    const selectionRevision = controller.getSnapshot().selection_intent_revision
    const session = await controller.createSession({
      title: sourceContext?.title || tRef.current('agent.sessions.untitled'),
      group_id: sourceContext || resourceReference ? undefined : draftGroupId,
      auto_title_allowed: automaticTitle && !sourceContext?.title,
      model_id: modelId,
      reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
      resource_reference: resourceReference,
    })
    const current = controller.getSnapshot()
    if (current.selected_session_id === session.id && current.selection_intent_revision === selectionRevision + 1
      && !sourceContext && !resourceReference) setDraftGroupId(undefined)
    return session
  }, [controller, draftGroupId, modelById, newSessionModelId, newSessionReasoningLevel, providerById])

  const ensureAttachmentDraftSession = useCallback((sourceContext?: AgentSourceContext) => {
    if (attachmentDraftSessionPromiseRef.current) return attachmentDraftSessionPromiseRef.current
    const promise = createDraftSession(sourceContext, undefined, true).finally(() => {
      if (attachmentDraftSessionPromiseRef.current === promise) {
        attachmentDraftSessionPromiseRef.current = null
      }
    })
    attachmentDraftSessionPromiseRef.current = promise
    return promise
  }, [createDraftSession])

  const createIndependentDraftSession = useCallback(async (
    sourceContext: AgentSourceContext,
    resourceReference?: AgentResourceReference,
  ) => {
    const pendingAttachmentSession = attachmentDraftSessionPromiseRef.current
    if (pendingAttachmentSession) {
      try {
        await pendingAttachmentSession
      } catch {
        // 附件草稿创建失败不应阻止业务入口随后创建独立会话。
      }
    }
    return createDraftSession(sourceContext, resourceReference)
  }, [createDraftSession])

  const ensureAttachmentSession = useCallback(async () => {
    const selection = controller.getSnapshot()
    if (selection.selected_session_id) return selection.selected_session_id
    const sourceContext = draftSourceContexts.new
    const session = await ensureAttachmentDraftSession(sourceContext)
    const current = controller.getSnapshot()
    const ownsDraft = current.selected_session_id === session.id
      && current.selection_intent_revision === selection.selection_intent_revision + 1
    const newDraft = (ownsDraft ? current : selection).drafts.new?.text ?? ''
    // 创建期间继续输入的内容跟随原草稿；用户另开草稿后，迟到回执只保存发起时的内容。
    if (newDraft && !current.drafts[session.id]) controller.updateDraft(session.id, newDraft)
    if (ownsDraft) controller.updateDraft('new', '')
    if (sourceContext) {
      setDraftSourceContexts((contexts) => {
        const next = { ...contexts, [session.id]: sourceContext }
        if (ownsDraft && contexts.new === sourceContext) delete next.new
        return next
      })
    }
    return session.id
  }, [controller, draftSourceContexts.new, ensureAttachmentDraftSession])

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
  const resourceBinding = selected?.resource_binding
  const resourceContext = useMemo(
    () => resourceBinding
      ? projectResourceContext(
          resourceBinding,
          sshResources,
          sshResourcesReady && state.snapshot_complete,
        )
      : undefined,
    [resourceBinding, sshResources, sshResourcesReady, state.snapshot_complete],
  )
  const approvalBypass = readiness?.mcp_policy?.approval_bypass
  const createReferenceSession = useCallback(async (request: AgentTerminalReferenceLaunch) => {
    if (attachmentDraftSessionPromiseRef.current) {
      await attachmentDraftSessionPromiseRef.current.catch(() => undefined)
    }
    return createDraftSession(undefined, request.resource_reference, true)
  }, [createDraftSession])
  const referenceImport = useAgentTerminalReferenceImport({
    intent: launchIntent?.source === 'terminal_selection' ? launchIntent : undefined,
    controller,
    active,
    ready: enabled && activeSetupReady && state.snapshot_complete,
    modelReady: newSessionModelRunnable,
    resourcesReady: sshResourcesReady,
    resources: sshResources,
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
    <AgentTerminalReferenceImportNotice job={referenceImport.current} resources={sshResources}
      onConfirm={referenceImport.confirm} onRetry={referenceImport.retry} onDismiss={referenceImport.dismiss}
      onOpenSettings={onOpenSettings} />
  ) : null
  const approvalPolicy = useMemo(() => activeSetupReady && approvalBypass !== undefined
    ? {
        status: 'ready' as const,
        mode: agentApprovalModeFromBypass(approvalBypass),
      }
    : { status: 'unavailable' as const }, [activeSetupReady, approvalBypass])

  useEffect(() => {
    if (!activeSetupReady || !workspaceInfrastructureReady || !newSessionModelRunnable || !launchIntent) return
    if (launchIntent.source === 'terminal_selection') return
    if (handledLaunchIntentRef.current === launchIntent.key) return
    handledLaunchIntentRef.current = launchIntent.key
    const resourceReference = launchIntent.source === 'workbench'
      ? launchIntent.resource_reference
      : undefined
    void createIndependentDraftSession(launchIntent.source_context, resourceReference).then((session) => {
      const prompt = tRef.current(`agent.launch.prompt.${launchIntent.source_context.kind}`)
      controller.updateDraft(session.id, prompt)
      setDraftSourceContexts((contexts) => ({ ...contexts, [session.id]: launchIntent.source_context }))
      onLaunchIntentHandled?.(launchIntent.key)
    }).catch((error) => {
      handledLaunchIntentRef.current = 0
      onLaunchIntentHandled?.(launchIntent.key)
      notifyError(notificationRef.current, tRef.current, error, 'resource')
    })
  }, [
    activeSetupReady,
    controller,
    createIndependentDraftSession,
    launchIntent,
    newSessionModelRunnable,
    onLaunchIntentHandled,
    workspaceInfrastructureReady,
  ])

  if (!enabled || !readiness || !workspaceInfrastructureReady) {
    return (
      <div className={styles.page}>
        {referenceNotice}
        <AgentReadinessSurface
          readiness={readiness}
          loading={setupLoading || operationBusy.workspace}
          onRefresh={() => void hydrateActiveSetup(activeSetupEpochRef.current)}
          onPrepare={() => void perform(async () => {
            const epoch = activeSetupEpochRef.current
            const result = await setupGateway.setup()
            const catalog = await loadAgentModelCatalog(setupGateway)
            if (activeSetupEpochRef.current !== epoch) return
            acceptSetupSnapshot(result, catalog.providers, catalog.models)
            markActiveSetupReady(epoch)
          })}
        />
      </div>
    )
  }

  const resourceRunBlocked = Boolean(resourceContext && resourceContext.status !== 'ready')
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
  return (
    <div className={styles.page}>
      {referenceNotice}
      {activeSetupFailed ? (
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
        draft_source_context={draftSourceContexts[selected?.id ?? 'new']}
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
        resource_context={resourceContext}
        onCreateSession={(groupId) => {
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
          setDraftSourceContexts((contexts) => omitKey(contexts, sessionId))
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
          setDraftSourceContexts((contexts) => omitKey(contexts, sessionId))
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
        onSend={async (message, attachmentIds, sourceContext) => {
          if (!activeSetupReady) return
          await perform(async () => {
            if (resourceRunBlocked) throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            let targetSession = selected
            if (!targetSession) {
              const modelId = newSessionModelId
              if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
              const model = modelById.get(modelId)
              if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
                throw new Error('AGENT_MODEL_UNAVAILABLE')
              }
              const selectionRevision = controller.getSnapshot().selection_intent_revision
              targetSession = await controller.createSession({
                title: createSessionTitle(message, t('agent.sessions.untitled')),
                group_id: draftGroupId,
                model_id: modelId,
                reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
              })
              controller.updateDraft(targetSession.id, message)
              const current = controller.getSnapshot()
              if (current.selected_session_id === targetSession.id && current.selection_intent_revision === selectionRevision + 1) {
                controller.updateDraft('new', '')
                setDraftModelId(readiness.settings.default_model_id
                  || firstRunnableModelId)
                setDraftReasoningLevel(undefined)
                setDraftGroupId(undefined)
              }
            }
            const targetSessionId = targetSession.id
            const clearCommittedDraft = () => {
              draftAttachments.clearCommitted(targetSessionId, attachmentIds ?? [])
              setDraftSourceContexts((contexts) => omitKey(contexts, targetSessionId))
            }
            try {
              await controller.startRun(targetSessionId, message, attachmentIds, sourceContext)
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
          }, resourceContext ? 'resource' : 'generic')
        }}
        onStop={async () => { await perform(() => controller.stopActiveRun(), 'generic', 'stop') }}
        onContextCompressionPendingChange={(enabled) => {
          if (!selected) return
          try {
            controller.setContextCompressionPending(selected.id, enabled)
          } catch {
            notifyError(notificationRef.current, tRef.current)
          }
        }}
        onRetryContext={() => {
          if (selected) void controller.reloadContext(selected.id)
        }}
        onQueueTurn={async (message, attachmentIds, sourceContext) => {
          if (!selected) return
          await perform(async () => {
            const submittedDraft = controller.getSnapshot().drafts[selected.id]
            await controller.enqueueTurn(selected.id, message, attachmentIds, sourceContext)
            if (controller.getSnapshot().drafts[selected.id] === submittedDraft) {
              controller.updateDraft(selected.id, '')
            }
            draftAttachments.clearCommitted(selected.id, attachmentIds ?? [])
            setDraftSourceContexts((contexts) => omitKey(contexts, selected.id))
          }, resourceContext ? 'resource' : 'generic', 'queue')
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
          if (selected) await perform(
            () => controller.steerQueuedTurn(selected.id, turnId),
            'generic',
            'queue',
          )
        }}
        onResumeQueue={async () => {
          if (selected) await perform(() => controller.resumeQueue(selected.id), 'generic', 'queue')
        }}
        onRetryUsage={() => {
          if (selected) void controller.reloadUsage(selected.id)
        }}
        onApprovalModeChange={changeApprovalMode}
        onReplaceResourceBinding={async (sessionId) => {
          if (!selected) return false
          return await performResourceMutation(selected.id, async () => {
            await controller.replaceResourceBinding(selected.id, {
              kind: 'ssh_session',
              session_id: sessionId,
              expected_revision: selected.revision,
            })
          })
        }}
        onRemoveResourceBinding={async () => {
          if (!selected) return false
          return await performResourceMutation(
            selected.id,
            () => controller.removeResourceBinding(selected.id, selected.revision),
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
  binding: NonNullable<AgentSession['resource_binding']>,
  resources: AgentSSHResourceState[],
  snapshotReady: boolean,
): AgentWorkspaceResourceContext {
  const live = resources.find(({ session_id }) => session_id === binding.session_id)
  const identityMatches = live
    && live.host_id === binding.host_id
    && live.ssh_profile_id === binding.ssh_profile_id
  return {
    binding,
    status: !snapshotReady ? 'checking' : !identityMatches ? 'stale' : live.status,
    ...(identityMatches ? { live_resource: live } : {}),
    candidates: resources
      .filter(({ status }) => status === 'ready')
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at)),
  }
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

function omitKey<Value>(values: Record<string, Value>, key: string) {
  if (!(key in values)) return values
  const next = { ...values }
  delete next[key]
  return next
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
        title: t('agent.resource.error.unavailableTitle'),
        description: t(`agent.resource.error.reason.${resourceError.reason}`),
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
