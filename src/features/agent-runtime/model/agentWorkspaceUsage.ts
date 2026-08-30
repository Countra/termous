import type { AgentSessionUsage } from '#entities/agent'
import type { AgentWorkspaceState } from './agentWorkspaceState.ts'
import type { AgentWorkspaceSessionUsageState } from './agentWorkspaceUsageTypes.ts'

export function beginAgentSessionUsageLoad(
  current: AgentWorkspaceState,
  sessionId: string,
): AgentWorkspaceState {
  const previous = current.session_usages[sessionId]
  return replaceUsage(current, sessionId, {
    phase: 'loading',
    value: previous?.value,
  })
}

export function acceptAgentSessionUsage(
  current: AgentWorkspaceState,
  value: AgentSessionUsage,
): AgentWorkspaceState {
  if (!current.sessions.some(({ id }) => id === value.session_id)) return current
  return replaceUsage(current, value.session_id, {
    phase: 'ready',
    value,
  })
}

export function failAgentSessionUsageLoad(
  current: AgentWorkspaceState,
  sessionId: string,
  errorCode: string,
): AgentWorkspaceState {
  if (!current.sessions.some(({ id }) => id === sessionId)) return current
  return replaceUsage(current, sessionId, {
    phase: 'error',
    value: current.session_usages[sessionId]?.value,
    error_code: errorCode,
  })
}

function replaceUsage(
  current: AgentWorkspaceState,
  sessionId: string,
  value: AgentWorkspaceSessionUsageState,
): AgentWorkspaceState {
  return {
    ...current,
    session_usages: { ...current.session_usages, [sessionId]: value },
  }
}
