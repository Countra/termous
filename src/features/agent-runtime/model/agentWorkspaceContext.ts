import type { AgentSessionContext } from '#entities/agent'
import type { AgentWorkspaceState } from './agentWorkspaceState.ts'
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
  if (!current.sessions.some(({ id }) => id === value.session_id)) return current
  const previous = current.session_contexts[value.session_id]
  return replaceContext(current, value.session_id, {
    phase: 'ready',
    value,
    compression_pending: value.compression_available
      ? previous?.compression_pending ?? false
      : false,
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
