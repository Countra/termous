import type {
  AgentMessage,
  AgentMessagePart,
  AgentModelProfile,
  AgentRun,
  AgentRunEvent,
  AgentSession,
} from '#entities/agent'
import { isAgentRunActive } from '#entities/agent'
import type { AgentRuntimeStatus } from '#common/contracts'
import type {
  AgentWorkspaceMessage,
  AgentWorkspaceMessagePart,
  AgentWorkspaceRunStatus,
  AgentWorkspaceSession,
  AgentWorkspaceToolPart,
} from '#widgets/agent-workspace'

const sensitiveKey = /(?:api[_-]?key|authorization|bearer|credential|pass(?:word|phrase)?|private[_-]?key|secret|token)/i
const maximumToolDetailLength = 4_000

export function projectAgentSessions(
  sessions: AgentSession[],
  profiles: AgentModelProfile[],
  runs: Record<string, AgentRun>,
): AgentWorkspaceSession[] {
  const models = new Map(profiles.map((profile) => [profile.id, profile.name]))
  return sessions.filter((session) => !session.archived_at).map((session) => ({
    id: session.id,
    title: session.title,
    model_profile_id: session.model_profile_id,
    model_name: models.get(session.model_profile_id) ?? session.model_profile_id,
    updated_at: session.updated_at,
    archived: false,
    run_status: latestSessionRun(session.id, runs)?.status ?? 'idle',
  }))
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
    const streaming = message.status === 'pending' || message.status === 'streaming'
    const status: AgentWorkspaceMessage['status'] = message.status === 'pending' ? 'streaming' : message.status
    const sourcePart = message.parts.find((part): part is Extract<AgentMessagePart, { kind: 'text' }> => (
      part.kind === 'text' && part.source_context !== undefined
    ))
    return {
      id: message.id,
      role: message.role,
      status,
      created_at: message.created_at,
      parts: projectMessageParts(message.parts, streaming, finalizedParts, run, events),
      attachments: message.attachments,
      source_context: sourcePart?.source_context,
    }
  })
}

export function latestSessionRun(sessionId: string, runs: Record<string, AgentRun>) {
  return Object.values(runs)
    .filter((run) => run.session_id === sessionId)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0]
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
