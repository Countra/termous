import { App as AntdApp, Alert } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isAgentModelRunnable,
  type AgentLaunchIntent,
  type AgentModel,
  type AgentModelProvider,
  type AgentResourceReference,
  type AgentReasoningLevel,
  type AgentReadiness,
  type AgentSession,
  type AgentSSHResourceState,
  type AgentSourceContext,
} from '#entities/agent'
import { loadAgentModelCatalog, type AgentSetupGateway } from '#features/agent-setup'
import {
  AgentRuntimeStartError,
  AgentWorkspaceController,
  useAgentDraftAttachments,
  type AgentWorkspaceGateway,
} from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import {
  AgentWorkspace,
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
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const controller = useMemo(() => new AgentWorkspaceController({ gateway }), [gateway])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)
  const [providers, setProviders] = useState<AgentModelProvider[]>([])
  const [models, setModels] = useState<AgentModel[]>([])
  const [setupLoading, setSetupLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draftModelId, setDraftModelId] = useState<string>()
  const [draftReasoningLevel, setDraftReasoningLevel] = useState<AgentReasoningLevel>()
  const [draftSourceContexts, setDraftSourceContexts] = useState<Record<string, AgentSourceContext>>({})
  const [activeSetupReadyEpoch, setActiveSetupReadyEpoch] = useState(0)
  const busyRef = useRef(false)
  const attachmentDraftSessionPromiseRef = useRef<Promise<AgentSession> | null>(null)
  const attachmentDraftSessionIdsRef = useRef(new Set<string>())
  const handledLaunchIntentRef = useRef(0)
  const setupLoadRequestRef = useRef(0)
  const activeSetupEpochRef = useRef(0)
  const activeSetupReadyEpochRef = useRef(0)
  const activeSetupAbortRef = useRef<AbortController | null>(null)
  const notificationRef = useRef(notification)
  const tRef = useRef(t)
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
  }, [])

  const hydrateActiveSetup = useCallback((epoch: number) => {
    activeSetupAbortRef.current?.abort()
    const controller = new AbortController()
    activeSetupAbortRef.current = controller
    activeSetupReadyEpochRef.current = 0
    setActiveSetupReadyEpoch(0)
    return loadSetup(
      controller.signal,
      () => activeSetupEpochRef.current === epoch,
    ).then((accepted) => {
      if (accepted && !controller.signal.aborted) markActiveSetupReady(epoch)
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

  useEffect(() => {
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
  ) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
      return true
    } catch (error) {
      notifyError(notificationRef.current, tRef.current, error, errorContext)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
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
  ) => {
    const modelId = newSessionModelId
    if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
    const model = modelById.get(modelId)
    if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
      throw new Error('AGENT_MODEL_UNAVAILABLE')
    }
    const session = await controller.createSession({
      title: sourceContext?.title || tRef.current('agent.sessions.untitled'),
      model_id: modelId,
      reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
      resource_reference: resourceReference,
    })
    controller.selectSession(session.id)
    return session
  }, [controller, modelById, newSessionModelId, newSessionReasoningLevel, providerById])

  const ensureAttachmentDraftSession = useCallback((sourceContext?: AgentSourceContext) => {
    if (attachmentDraftSessionPromiseRef.current) return attachmentDraftSessionPromiseRef.current
    const promise = createDraftSession(sourceContext).finally(() => {
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
    const current = controller.getSnapshot().selected_session_id
    if (current) return current
    const newDraft = controller.getSnapshot().drafts.new?.text ?? ''
    const sourceContext = draftSourceContexts.new
    const session = await ensureAttachmentDraftSession(sourceContext)
    attachmentDraftSessionIdsRef.current.add(session.id)
    if (newDraft) controller.updateDraft(session.id, newDraft)
    controller.updateDraft('new', '')
    if (sourceContext) {
      setDraftSourceContexts((contexts) => {
        const next = { ...contexts, [session.id]: sourceContext }
        delete next.new
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
  })

  useEffect(() => {
    if (!active || !workspaceInfrastructureReady || !newSessionModelRunnable || !launchIntent) return
    if (activeSetupReadyEpoch !== activeSetupEpochRef.current
      || activeSetupReadyEpochRef.current !== activeSetupEpochRef.current) return
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
    active,
    activeSetupReadyEpoch,
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
        <AgentReadinessSurface
          readiness={readiness}
          loading={setupLoading || busy}
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

  const selectedRun = selected ? latestSessionRun(selected.id, state.runs) : undefined
  const resourceContext = selected?.resource_binding
    ? projectResourceContext(
        selected.resource_binding,
        sshResources,
        sshResourcesReady && state.snapshot_complete,
      )
    : undefined
  const resourceRunBlocked = Boolean(resourceContext && resourceContext.status !== 'ready')
  const activeRun = state.active_run_id ? state.runs[state.active_run_id] : undefined
  const runEvents = selectedRun ? state.run_events[selectedRun.id] ?? [] : []
  const selectedModel = modelById.get(selected?.model_id ?? newSessionModelId ?? '')
  const selectedReasoningLevel = selected?.reasoning_level ?? newSessionReasoningLevel
  const selectedModelRunnable = Boolean(selectedModel && isAgentModelRunnable(
    selectedModel,
    providerById.get(selectedModel.provider_id),
  ) && selectedModel.supported_reasoning_levels.includes(selectedReasoningLevel))
  const selectedContext = selected ? state.session_contexts[selected.id] : undefined
  const contextSnapshot = selectedContext?.value
  const selectedUsage = selected ? state.session_usages[selected.id] : undefined
  const usageSnapshot = selectedUsage?.value
  const inspector: AgentWorkspaceInspectorState = {
    context: {
      phase: selected ? selectedContext?.phase ?? 'idle' : 'unavailable',
      has_snapshot: Boolean(contextSnapshot),
      used_tokens: contextSnapshot?.estimated_tokens ?? 0,
      context_window_tokens: contextSnapshot?.context_window_tokens ?? 0,
      estimated: contextSnapshot?.estimated ?? true,
      warning: contextSnapshot?.warning ?? false,
      compression_available: contextSnapshot?.compression_available ?? false,
      compression_pending: selectedContext?.compression_pending ?? false,
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
      approval_bypass: readiness.mcp_policy?.approval_bypass ?? false,
    },
  }

  return (
    <div className={styles.page}>
      {state.error_code ? (
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
        sessions={workspaceSessions}
        selected_session_id={state.selected_session_id}
        messages={projectAgentMessages(selected ? state.messages[selected.id] ?? [] : [], selectedRun, runEvents)}
        models={workspaceModelOptions}
        selected_model_id={selected?.model_id ?? newSessionModelId}
        default_model_id={readiness.settings.default_model_id ?? firstRunnableModelId}
        selected_reasoning_level={selectedReasoningLevel}
        inspector={inspector}
        draft={state.drafts[selected?.id ?? 'new']?.text ?? ''}
        draft_source_context={draftSourceContexts[selected?.id ?? 'new']}
        draft_attachments={(draftAttachments.records[selected?.id ?? 'new'] ?? []).map((record) => ({
          client_id: record.client_id,
          name: record.file.name,
          size_bytes: record.file.size,
          kind: record.kind,
          phase: record.phase,
          attachment: record.attachment,
          error_code: record.error_code,
        }))}
        supports_images={selectedModel?.supports_images ?? false}
        model_runnable={selectedModelRunnable}
        show_turn_token_usage={readiness.settings.show_turn_token_usage}
        loading={state.phase === 'loading'}
        busy={busy}
        active_run={activeRun ? {
          session_id: activeRun.session_id,
          status: activeRun.status,
        } : undefined}
        run_blocked={agentRunInteractionBlocked(
          state.active_run_id,
          selectedRun,
          state.runtime_status,
        )}
        resource_run_blocked={resourceRunBlocked}
        resource_context={resourceContext}
        onCreateSession={() => {
          controller.selectSession(undefined)
          const modelId = readiness.settings.default_model_id ?? firstRunnableModelId
          const model = modelId ? modelById.get(modelId) : undefined
          setDraftModelId(modelId)
          setDraftReasoningLevel(model?.effective_default_reasoning_level ?? 'off')
        }}
        onSelectSession={(sessionId) => controller.selectSession(sessionId)}
        onReturnToActiveRun={() => {
          if (activeRun) controller.selectSession(activeRun.session_id)
        }}
        onArchiveSession={(sessionId) => void perform(async () => {
          const session = requireSession(state.sessions, sessionId)
          const selection = controller.getSnapshot()
          const nextSessionId = selectionAfterSessionRemoval(workspaceSessions, sessionId)
          await controller.updateSession(sessionId, updateInput(session, true))
          await draftAttachments.discard(sessionId)
          attachmentDraftSessionIdsRef.current.delete(sessionId)
          setDraftSourceContexts((contexts) => omitKey(contexts, sessionId))
          if (
            selection.selected_session_id === sessionId
            && controller.getSnapshot().selection_intent_revision === selection.selection_intent_revision
          ) {
            controller.selectSession(nextSessionId)
          }
        })}
        onDeleteSession={(sessionId) => void perform(async () => {
          const session = requireSession(state.sessions, sessionId)
          await controller.deleteSession(sessionId, session.revision)
          draftAttachments.clear(sessionId)
          attachmentDraftSessionIdsRef.current.delete(sessionId)
          setDraftSourceContexts((contexts) => omitKey(contexts, sessionId))
        })}
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
        onAttachFiles={draftAttachments.add}
        onRemoveAttachment={draftAttachments.remove}
        onRetryAttachment={draftAttachments.retry}
        onLoadAttachmentContent={loadAttachmentContent}
        onSend={async (message, attachmentIds, sourceContext) => {
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
              targetSession = await controller.createSession({
                title: createSessionTitle(message, t('agent.sessions.untitled')),
                model_id: modelId,
                reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
              })
              controller.updateDraft(targetSession.id, message)
              controller.updateDraft('new', '')
              setDraftModelId(readiness.settings.default_model_id
                || firstRunnableModelId)
              setDraftReasoningLevel(undefined)
            }
            if (attachmentDraftSessionIdsRef.current.has(targetSession.id)) {
              targetSession = await controller.updateSession(targetSession.id, {
                ...updateInput(targetSession, false),
                title: createSessionTitle(message, t('agent.sessions.untitled')),
              })
              attachmentDraftSessionIdsRef.current.delete(targetSession.id)
            }
            const targetSessionId = targetSession.id
            const clearCommittedDraft = () => {
              draftAttachments.clear(targetSessionId)
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
        onSteer={async (message) => {
          await perform(async () => {
            if (resourceRunBlocked) throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
            const targetSessionId = selected?.id
            const submittedDraft = targetSessionId
              ? controller.getSnapshot().drafts[targetSessionId]
              : undefined
            await controller.steerActiveRun(message)
            if (targetSessionId && controller.getSnapshot().drafts[targetSessionId] === submittedDraft) {
              controller.updateDraft(targetSessionId, '')
            }
          }, resourceContext ? 'resource' : 'generic')
        }}
        onStop={async () => { await perform(() => controller.stopActiveRun()) }}
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
        onRetryUsage={() => {
          if (selected) void controller.reloadUsage(selected.id)
        }}
        onApprovalBypassChange={async (approvalBypass) => {
          const policy = readiness.mcp_policy
          if (!policy) throw new Error('AGENT_MCP_POLICY_MISSING')
          const updated = await perform(async () => {
            const next = await gateway.updateMcpPolicy({
              approval_bypass: approvalBypass,
              sync_scopes: false,
              expected_revision: policy.revision,
            })
            setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
          })
          if (!updated) throw new Error('AGENT_MCP_POLICY_UPDATE_FAILED')
        }}
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
    </div>
  )
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
