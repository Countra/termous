import { isAgentRunTerminal, type AgentContextLastSnapshot, type AgentContextUsageData, type AgentRun, type AgentSessionContext } from '#entities/agent'
import type { AgentWorkspaceState } from './agentWorkspaceStateTypes.ts'
import type { AgentWorkspaceSessionContextState } from './agentWorkspaceContextTypes.ts'

export function beginAgentSessionContextLoad(
  current: AgentWorkspaceState,
  sessionId: string,
): AgentWorkspaceState {
  const previous = current.session_contexts[sessionId]
  return replaceContext(current, sessionId, {
    phase: 'loading',
    value: previous?.value,
    compression_pending: previous?.compression_pending ?? false,
  })
}

export function acceptAgentSessionContext(
  current: AgentWorkspaceState,
  value: AgentSessionContext,
): AgentWorkspaceState {
  const session = current.sessions.find(({ id }) => id === value.session_id)
  if (!session || value.model_id !== undefined && value.model_id !== session.model_id) return current
  const previous = current.session_contexts[value.session_id]
  return replaceContext(current, value.session_id, {
    phase: 'ready',
    value,
    compression_pending: agentContextCompressionStatus(value) === 'unavailable'
      ? false : previous?.compression_pending ?? false,
  })
}

export function agentContextCompressionStatus(value?: Pick<AgentContextUsageData, 'compression_status' | 'compression_available'>) {
  return value?.compression_status ?? (value ? value.compression_available ? 'available' : 'unavailable' : 'unknown')
}

export function markAgentSessionContextPending(
  current: AgentWorkspaceState,
  sessionId: string,
  modelId: string,
  previousModelId: string,
): AgentWorkspaceState {
  const previous = current.session_contexts[sessionId]
  const value = previous?.value
  const sourceModelId = value?.model_id ?? previousModelId
  const run = Object.values(current.runs).filter((candidate) => (
    candidate.session_id === sessionId && candidate.model_id === sourceModelId
  )).sort((left, right) => right.generation - left.generation)[0]
  const lastSnapshot = value?.assessment === 'pending' ? value.last_snapshot
    : value && value.context_window_tokens > 0 ? {
        model_id: sourceModelId,
        model_name: value.last_snapshot?.model_id === sourceModelId ? value.last_snapshot.model_name
          : run?.model_snapshot.model_display_name ?? sourceModelId,
        estimated_tokens: value.estimated_tokens,
        context_window_tokens: value.context_window_tokens,
        basis: value.basis,
      } : value?.last_snapshot
  return replaceContext(current, sessionId, {
    phase: 'loading', compression_pending: previous?.compression_pending ?? false,
    value: {
      session_id: sessionId, model_id: modelId, assessment: 'pending',
      // 目录窗口由页面提供；HTTP 返回前不借用旧模型窗口作为当前结论。
      estimated_tokens: 0, context_window_tokens: 0, estimated: true, warning: false,
      compression_available: false, compression_status: 'unknown',
      last_snapshot: lastSnapshot, checkpoint: value?.checkpoint,
    },
  })
}

export function acceptAgentContextUsage(
  current: AgentWorkspaceState,
  run: AgentRun,
  usage: AgentContextUsageData,
): AgentWorkspaceState {
  const session = current.sessions.find(({ id }) => id === run.session_id)
  if (!session) return current
  const previous = current.session_contexts[session.id]
  // 终态历史事件没有当前评估水位，保留已知值，最终用量由 Controller 回查持久化快照。
  if (isAgentRunTerminal(run.status) && previous?.value?.assessment !== 'pending'
    && previous?.value?.model_id === session.model_id) return current
  const snapshot: AgentContextLastSnapshot = {
    model_id: run.model_id, model_name: run.model_snapshot.model_display_name,
    estimated_tokens: usage.estimated_tokens, context_window_tokens: usage.context_window_tokens, basis: usage.basis,
  }
  if (run.model_id !== session.model_id || previous?.value?.assessment === 'pending' && isAgentRunTerminal(run.status)) {
    // 已评估的当前模型快照优先；旧任务只能补充待评估状态的参考，不能清除整理预约。
    if (previous?.value && previous.value.assessment !== 'pending' && previous.value.model_id === session.model_id) return current
    const pending = previous?.value?.assessment === 'pending' ? current
      : markAgentSessionContextPending(current, session.id, session.model_id, run.model_id)
    const reference = pending.session_contexts[session.id]!
    return replaceContext(pending, session.id, {
      ...reference, value: { ...reference.value!, last_snapshot: snapshot },
    })
  }
  return acceptAgentSessionContext(current, {
    ...usage, session_id: session.id, model_id: run.model_id, assessment: 'ready',
    last_snapshot: snapshot, checkpoint: previous?.value?.checkpoint,
  })
}

export function failAgentSessionContextLoad(
  current: AgentWorkspaceState,
  sessionId: string,
  errorCode: string,
): AgentWorkspaceState {
  if (!current.sessions.some(({ id }) => id === sessionId)) return current
  const previous = current.session_contexts[sessionId]
  return replaceContext(current, sessionId, {
    phase: 'error',
    value: previous?.value,
    compression_pending: previous?.compression_pending ?? false,
    error_code: errorCode,
  })
}

export function setAgentContextCompressionPending(
  current: AgentWorkspaceState,
  sessionId: string,
  pending: boolean,
): AgentWorkspaceState {
  const previous = current.session_contexts[sessionId]
  if (previous?.compression_pending === pending) return current
  return replaceContext(current, sessionId, {
    phase: previous?.phase ?? 'idle',
    value: previous?.value,
    compression_pending: pending,
    error_code: previous?.error_code,
  })
}

function replaceContext(
  current: AgentWorkspaceState,
  sessionId: string,
  value: AgentWorkspaceSessionContextState,
): AgentWorkspaceState {
  return {
    ...current,
    session_contexts: { ...current.session_contexts, [sessionId]: value },
  }
}
