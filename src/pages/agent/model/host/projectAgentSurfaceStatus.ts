import {
  isAgentModelRunnable,
  isAgentResourceRecoveryBlocking
} from '#entities/agent'
import {
  isAgentResourceBindingConnectionBlocking
} from '#features/agent-runtime'
import {
  type AgentWorkspaceInspectorState,
  type AgentWorkspaceSlashAvailability
} from '#widgets/agent-workspace'
import {
  compactDraftHasPayload,
  compactSlashDisabledReason,
  slashCommandAvailability,
  slashDisabledReason
} from '../agentSlashExecution.ts'
import { projectMcpConnection } from './agentHostHelpers.ts'

interface Context {
  resourceContexts: import('#widgets/agent-workspace').AgentWorkspaceResourceContext[]
  recovery: ReturnType<typeof import('#features/agent-runtime').useAgentResourceRecovery>
  profileConnection: ReturnType<typeof import('#features/agent-runtime').useAgentResourceBindingConnection>
  selected: import('#entities/agent').AgentSession | undefined
  state: import('#features/agent-runtime').AgentWorkspaceState
  modelById: Map<string, import('#entities/agent').AgentModel>
  newSessionModelId: string | undefined
  newSessionReasoningLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  providerById: Map<string, import('#entities/agent').AgentModelProvider>
  selectedQueuedTurns: import('#entities/agent').AgentQueuedTurn[]
  slashExecutionSessionIds: ReadonlySet<string>
  activeSetupReady: boolean
  workspaceInfrastructureReady: boolean
  selectedQueuedTurnEdit: ReturnType<import('#features/agent-runtime').AgentWorkspaceController['getSnapshot']>['queued_turn_edits'][string] | undefined
  operationBusy: import('./agentHostHelpers.ts').AgentOperationBusy
  workflowResourcesReady: boolean
  remote: boolean
  desktopResourcesReady: boolean
  readiness: import('#entities/agent').AgentReadiness
}

export function projectAgentSurfaceStatus({ resourceContexts, recovery, profileConnection, selected, state, modelById, newSessionModelId, newSessionReasoningLevel, providerById, selectedQueuedTurns, slashExecutionSessionIds, activeSetupReady, workspaceInfrastructureReady, selectedQueuedTurnEdit, operationBusy, workflowResourcesReady, remote, desktopResourcesReady, readiness }: Context) {
  const resourceRunBlocked = resourceContexts.some(({ status }) => status !== 'ready')
  const resourceRecoveryBlocked = isAgentResourceRecoveryBlocking(recovery.state)
  const resourceConnectionBlocked = isAgentResourceBindingConnectionBlocking(profileConnection.state)
  const activeRun = selected && state.active_run_ids[selected.id] ? state.runs[state.active_run_ids[selected.id]!] : undefined
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
    workflow: slashCommandAvailability(resourceSlashEnabled && workflowResourcesReady && !remote, workflowResourcesReady ? resourceSlashDisabledReason : 'workspace_unavailable'),
    session: {
      ...slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      resource_kinds: {
        ssh: slashCommandAvailability(sshSlashEnabled, sshSlashDisabledReason),
        file: slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
        desktop: slashCommandAvailability(resourceSlashEnabled && desktopResourcesReady && !remote, desktopResourcesReady ? resourceSlashDisabledReason : 'workspace_unavailable'),
      },
    },
    profile: {
      ...slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
      resource_kinds: {
        ssh: slashCommandAvailability(sshSlashEnabled, sshSlashDisabledReason),
        file: slashCommandAvailability(resourceSlashEnabled, resourceSlashDisabledReason),
        desktop: slashCommandAvailability(resourceSlashEnabled && desktopResourcesReady && !remote, desktopResourcesReady ? resourceSlashDisabledReason : 'workspace_unavailable'),
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
      compression_trigger_tokens: contextSnapshot?.compression_trigger_tokens,
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
      connection: projectMcpConnection(Boolean(activeRun), state.runtime_status?.state),
      scope_count: readiness.mcp_policy?.scope_count ?? 0,
    },
  }

  return { resourceRunBlocked, resourceRecoveryBlocked, resourceConnectionBlocked, activeRun, selectedModel, selectedReasoningLevel, selectedModelRunnable, queuedTurnCounts, slashExecutionCurrent, slashAvailability, inspector }
}
