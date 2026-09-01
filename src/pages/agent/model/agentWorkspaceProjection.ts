import type {
  AgentMessage,
  AgentMessagePart,
  AgentModel,
  AgentModelProvider,
  AgentReadiness,
  AgentRun,
  AgentRunEvent,
  AgentSession,
} from '#entities/agent'
import { isAgentModelRunnable, isAgentRunActive, isAgentRunTerminal } from '#entities/agent'
import type { AgentRuntimeStatus } from '#common/contracts'
import type {
  AgentWorkspaceMessage,
  AgentWorkspaceMessagePart,
  AgentWorkspaceModelOption,
  AgentWorkspaceRunStatus,
  AgentWorkspaceSession,
  AgentWorkspaceToolPart,
} from '#widgets/agent-workspace'

const sensitiveKey = /(?:api[_-]?key|authorization|bearer|credential|pass(?:word|phrase)?|private[_-]?key|secret|token)/i
const maximumToolDetailLength = 4_000

export function agentWorkspaceInfrastructureReady(readiness: AgentReadiness) {
  return readiness.mcp_runtime.status === 'ready'
    && readiness.mcp_client.status === 'ready'
    && readiness.skills_bundle.status === 'ready'
}

export function projectAgentModelOptions(
  models: AgentModel[],
  providersById: ReadonlyMap<string, AgentModelProvider>,
): AgentWorkspaceModelOption[] {
  return models.map((model) => {
    const provider = providersById.get(model.provider_id)
    return {
      id: model.id,
      display_name: model.display_name,
      provider_id: model.provider_id,
      provider_name: provider?.name ?? model.provider_id,
      remote_model_id: model.remote_model_id,
      source: model.source,
      supports_images: model.supports_images,
      reasoning_control: model.reasoning_control,
      supported_reasoning_levels: model.supported_reasoning_levels,
      effective_default_reasoning_level: model.effective_default_reasoning_level,
      effective_context_window_tokens: model.effective_context_window_tokens,
      effective_max_output_tokens: model.effective_max_output_tokens,
      runnable: isAgentModelRunnable(model, provider),
      unavailable_reason: model.removed_at
        ? 'removed'
        : model.availability === 'missing'
          ? 'missing'
          : !provider?.enabled ? 'provider_disabled'
            : model.source === 'sync' && provider?.refresh_status !== 'ready'
              ? 'catalog_stale'
              : undefined,
    }
  })
}

export function projectAgentSessions(
  sessions: AgentSession[],
  models: AgentModel[],
  providers: AgentModelProvider[],
  runs: Record<string, AgentRun>,
): AgentWorkspaceSession[] {
  const modelsById = new Map(models.map((model) => [model.id, model]))
  const providersById = new Map(providers.map((provider) => [provider.id, provider]))
  const latestRuns = indexLatestRuns(runs)
  return sessions.filter((session) => !session.archived_at).map((session) => {
    const model = modelsById.get(session.model_id)
    const provider = model ? providersById.get(model.provider_id) : undefined
    const snapshot = latestRuns.bySessionModel
      .get(sessionModelKey(session.id, session.model_id))
      ?.model_snapshot
    return {
      id: session.id,
      title: session.title,
      model_id: session.model_id,
      model_name: model?.remote_model_id ?? snapshot?.model_id ?? session.model_id,
      model_alias: model?.display_name ?? snapshot?.model_display_name,
      provider_name: provider?.name ?? snapshot?.provider_name,
      updated_at: session.updated_at,
      archived: false,
      run_status: latestRuns.bySession.get(session.id)?.status ?? 'idle',
      resource_binding: session.resource_binding,
    }
  })
}

export function projectAgentMessages(
  messages: AgentMessage[],
  run: AgentRun | undefined,
  events: AgentRunEvent[],
): AgentWorkspaceMessage[] {
  const finalizedParts = new Set(events.flatMap((event) => (
    event.kind === 'message_part'
      ? [messagePartKey(event.payload.message_part.message_id, event.payload.message_part.id)]
      : []
  )))
  return messages.map((message): AgentWorkspaceMessage => {
    const messageRun = run
      && run.session_id === message.session_id
      && run.assistant_message_id === message.id
      ? run
      : undefined
    const messageEvents = messageRun ? events : []
    const streaming = message.status === 'pending' || message.status === 'streaming'
    const status: AgentWorkspaceMessage['status'] = (
      messageRun?.error_code ?? message.turn_usage?.error_code
    ) === 'AGENT_RUN_STEERED'
      ? 'interrupted_by_steer'
      : message.status === 'pending' ? 'streaming' : message.status
    const usage = message.role === 'assistant' && !streaming
      ? (messageRun && isAgentRunTerminal(messageRun.status) ? messageRun.usage : undefined)
        ?? message.turn_usage?.usage
      : undefined
    const sourcePart = message.parts.find((part): part is Extract<AgentMessagePart, { kind: 'text' }> => (
      part.kind === 'text' && part.source_context !== undefined
    ))
    return {
      id: message.id,
      role: message.role,
      status,
      created_at: message.created_at,
      parts: projectMessageParts(message.parts, streaming, finalizedParts, messageRun, messageEvents),
      attachments: message.attachments,
      source_context: sourcePart?.source_context,
      usage: usage && usage.total_tokens > 0 ? usage : undefined,
    }
  })
}

export function latestSessionRun(sessionId: string, runs: Record<string, AgentRun>) {
  let latest: AgentRun | undefined
  for (const run of Object.values(runs)) {
    if (run.session_id === sessionId && (!latest || runUpdatedAfter(run, latest))) latest = run
  }
  return latest
}

function indexLatestRuns(runs: Record<string, AgentRun>) {
  const bySession = new Map<string, AgentRun>()
  const bySessionModel = new Map<string, AgentRun>()
  for (const run of Object.values(runs)) {
    const sessionRun = bySession.get(run.session_id)
    if (!sessionRun || runUpdatedAfter(run, sessionRun)) bySession.set(run.session_id, run)
    const modelKey = sessionModelKey(run.session_id, run.model_id)
    const modelRun = bySessionModel.get(modelKey)
    if (!modelRun || runUpdatedAfter(run, modelRun)) bySessionModel.set(modelKey, run)
  }
  return { bySession, bySessionModel }
}

function sessionModelKey(sessionId: string, modelId: string) {
  return `${sessionId}\u0000${modelId}`
}

function runUpdatedAfter(candidate: AgentRun, current: AgentRun) {
  const updatedAtOrder = compareTimestamp(candidate.updated_at, current.updated_at)
  if (updatedAtOrder !== 0) return updatedAtOrder > 0
  const queuedAtOrder = compareTimestamp(candidate.queued_at, current.queued_at)
  if (queuedAtOrder !== 0) return queuedAtOrder > 0
  return candidate.id.localeCompare(current.id) > 0
}

function compareTimestamp(left: string, right: string) {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
  if (Number.isFinite(leftTime)) return 1
  if (Number.isFinite(rightTime)) return -1
  return left.localeCompare(right)
}

export function agentRunInteractionBlocked(
  activeRunId: string | undefined,
  selectedRun: AgentRun | undefined,
  runtimeStatus: AgentRuntimeStatus | undefined,
) {
  if (!activeRunId) return false
  if (!selectedRun || selectedRun.id !== activeRunId || !isAgentRunActive(selectedRun.status)) return true
  return runtimeStatus?.state !== 'running'
    || runtimeStatus.active_run_id !== selectedRun.id
    || runtimeStatus.generation !== selectedRun.generation
}

export function selectionAfterSessionRemoval(
  sessions: AgentWorkspaceSession[],
  removedSessionId: string,
) {
  const removedIndex = sessions.findIndex((session) => session.id === removedSessionId)
  if (removedIndex < 0) return sessions[0]?.id
  return sessions[removedIndex + 1]?.id ?? sessions[removedIndex - 1]?.id
}

function projectMessageParts(
  parts: AgentMessagePart[],
  streaming: boolean,
  finalizedParts: ReadonlySet<string>,
  run: AgentRun | undefined,
  events: AgentRunEvent[],
): AgentWorkspaceMessage['parts'] {
  const results = new Map(parts
    .filter((part): part is Extract<AgentMessagePart, { kind: 'tool_result' }> => part.kind === 'tool_result')
    .map((part) => [part.tool_result.tool_call_id, part]))
  return parts.flatMap((part): AgentWorkspaceMessagePart[] => {
    if (part.kind === 'text') return [{ id: part.id, kind: 'text' as const, text: part.text }]
    if (part.kind === 'reasoning') return [{
      id: part.id,
      kind: 'reasoning' as const,
      text: part.text,
      streaming: streaming && !finalizedParts.has(messagePartKey(part.message_id, part.id)),
    }]
    if (part.kind === 'tool_result') return []
    const result = results.get(part.tool_call.tool_call_id)
    return [projectToolPart(part, result, run, events)]
  })
}

function messagePartKey(messageId: string, partId: string) {
  return `${messageId}\u0000${partId}`
}

function projectToolPart(
  call: Extract<AgentMessagePart, { kind: 'tool_call' }>,
  result: Extract<AgentMessagePart, { kind: 'tool_result' }> | undefined,
  run: AgentRun | undefined,
  events: AgentRunEvent[],
): AgentWorkspaceToolPart {
  const toolEvents = events.filter((event) => (
    'tool' in event.payload && event.payload.tool.tool_call_id === call.tool_call.tool_call_id
  ))
  const terminalEvent = [...toolEvents].reverse().find((event) => event.kind === 'tool_completed' || event.kind === 'tool_failed')
  const duration = terminalEvent && 'tool' in terminalEvent.payload ? terminalEvent.payload.tool.duration_ms : undefined
  const status = result
    ? result.tool_result.is_error ? 'failed' : 'completed'
    : run?.status === 'waiting_approval' ? 'waiting_approval'
      : run && ['queued', 'starting', 'running'].includes(run.status) ? 'running'
        : run?.status === 'failed' ? 'failed' : 'interrupted'
  return {
    id: call.id,
    kind: 'tool',
    name: call.tool_call.tool_name,
    status,
    duration_ms: duration,
    detail: boundedToolDetail({
      arguments: redactJson(call.tool_call.arguments),
      ...(result ? { result: redactJson(result.tool_result.content) } : {}),
    }),
  }
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => redactJson(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 128).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[redacted]' : redactJson(item, depth + 1),
  ]))
}

function boundedToolDetail(value: unknown) {
  const serialized = JSON.stringify(value, null, 2)
  if (serialized.length <= maximumToolDetailLength) return serialized
  return `${serialized.slice(0, maximumToolDetailLength)}\n...`
}

export function runStatus(run: AgentRun | undefined): AgentWorkspaceRunStatus {
  return run?.status ?? 'idle'
}
