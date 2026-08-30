import { App as AntdApp, Alert } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isAgentModelRunnable,
  type AgentLaunchIntent,
  type AgentModel,
  type AgentModelProvider,
  type AgentReadiness,
  type AgentSession,
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
import { AgentWorkspace, type AgentWorkspaceInspectorState } from '#widgets/agent-workspace'
import {
  agentRunInteractionBlocked,
  agentWorkspaceInfrastructureReady,
  latestSessionRun,
  projectAgentModelOptions,
  projectAgentMessages,
  projectAgentSessions,
  selectionAfterSessionRemoval,
} from '../model/agentWorkspaceProjection.ts'
import { AgentReadinessSurface } from './AgentReadinessSurface.tsx'
import styles from './AgentPage.module.scss'

export function AgentPage({
  gateway,
  setupGateway,
  enabled,
  active,
  launchIntent,
  onLaunchIntentHandled,
  onRuntimeSummaryChange,
  onOpenSettings,
}: {
  gateway: AgentWorkspaceGateway
  setupGateway: AgentSetupGateway
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

  const perform = useCallback(async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
      return true
    } catch {
      notifyError(notificationRef.current, tRef.current)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const selected = state.sessions.find((session) => session.id === state.selected_session_id)
  const newSessionModelId = draftModelId
    ?? readiness?.settings.default_model_id
    ?? firstRunnableModelId
  const newSessionModel = newSessionModelId ? modelById.get(newSessionModelId) : undefined
  const newSessionModelRunnable = Boolean(newSessionModel && isAgentModelRunnable(
    newSessionModel,
    providerById.get(newSessionModel.provider_id),
  ))
  const workspaceInfrastructureReady = Boolean(
    readiness && agentWorkspaceInfrastructureReady(readiness),
  )
  const createDraftSession = useCallback(async (sourceContext?: AgentSourceContext) => {
    const modelId = newSessionModelId
    if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
    const model = modelById.get(modelId)
    if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
      throw new Error('AGENT_MODEL_UNAVAILABLE')
    }
    const session = await controller.createSession({
      title: sourceContext?.title || tRef.current('agent.sessions.untitled'),
      model_id: modelId,
      reasoning_level: model.supports_reasoning
        ? readiness?.settings.default_reasoning_level ?? 'off'
        : 'off',
    })
    controller.selectSession(session.id)
    return session
  }, [controller, modelById, newSessionModelId, providerById, readiness?.settings.default_reasoning_level])

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

  const createIndependentDraftSession = useCallback(async (sourceContext: AgentSourceContext) => {
    const pendingAttachmentSession = attachmentDraftSessionPromiseRef.current
    if (pendingAttachmentSession) {
      try {
        await pendingAttachmentSession
      } catch {
        // 附件草稿创建失败不应阻止业务入口随后创建独立会话。
      }
    }
    return createDraftSession(sourceContext)
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
    void createIndependentDraftSession(launchIntent.source_context).then((session) => {
      const prompt = tRef.current(`agent.launch.prompt.${launchIntent.source_context.kind}`)
      controller.updateDraft(session.id, prompt)
      setDraftSourceContexts((contexts) => ({ ...contexts, [session.id]: launchIntent.source_context }))
      onLaunchIntentHandled?.(launchIntent.key)
    }).catch(() => {
      handledLaunchIntentRef.current = 0
      onLaunchIntentHandled?.(launchIntent.key)
      notifyError(notificationRef.current, tRef.current)
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
  const activeRun = state.active_run_id ? state.runs[state.active_run_id] : undefined
  const runEvents = selectedRun ? state.run_events[selectedRun.id] ?? [] : []
  const selectedModel = modelById.get(selected?.model_id ?? newSessionModelId ?? '')
  const selectedModelRunnable = Boolean(selectedModel && isAgentModelRunnable(
    selectedModel,
    providerById.get(selectedModel.provider_id),
  ))
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
        onCreateSession={() => {
          controller.selectSession(undefined)
          setDraftModelId((current) => (
              current
              ?? readiness.settings.default_model_id
              ?? firstRunnableModelId
          ))
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
            reasoning_level: model.supports_reasoning ? selected.reasoning_level : 'off',
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
                reasoning_level: model.supports_reasoning ? readiness.settings.default_reasoning_level : 'off',
              })
              controller.updateDraft(targetSession.id, message)
              controller.updateDraft('new', '')
              setDraftModelId(readiness.settings.default_model_id
                || firstRunnableModelId)
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
          })
        }}
        onSteer={async (message) => {
          await perform(async () => {
            const targetSessionId = selected?.id
            const submittedDraft = targetSessionId
              ? controller.getSnapshot().drafts[targetSessionId]
              : undefined
            await controller.steerActiveRun(message)
            if (targetSessionId && controller.getSnapshot().drafts[targetSessionId] === submittedDraft) {
              controller.updateDraft(targetSessionId, '')
            }
          })
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
) {
  notification.error({
    title: t('agent.error.operation'),
    description: t('agent.error.operationDescription'),
    className: termousNotificationClassName,
  })
}
