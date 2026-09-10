import { getAgentResourceBinding, agentResourceBindingKey, resourceBindingMatchesSource, isAgentRunActive, type AgentReferenceTargetsSnapshot, type AgentResourceKind, type AgentResourceReferenceLaunch, type AgentSession, type AgentTerminalReferenceLaunch } from '#entities/agent'
import type { AgentWorkspaceState } from './agentWorkspaceStateTypes.ts'

export function projectAgentReferenceTargets(state: AgentWorkspaceState, enabled: boolean): AgentReferenceTargetsSnapshot {
  const locked = new Set(Object.values(state.runs).filter(({ status }) => isAgentRunActive(status)).map(({ session_id }) => session_id))
  for (const [id, turns] of Object.entries(state.queued_turns)) {
    if (turns.some(({ state: status }) => status === 'queued')) locked.add(id)
  }
  return {
    ready: enabled && state.snapshot_complete,
    targets: state.sessions.filter(({ archived_at }) => !archived_at).map((session) => ({
      session_id: session.id,
      title: session.title,
      pinned: session.pinned,
      last_activity_at: session.last_activity_at,
      resource_bindings: session.resource_bindings,
      binding_locked: locked.has(session.id),
    })),
  }
}

export function terminalReferenceChangesBinding(session: AgentSession, request: AgentResourceReferenceLaunch): boolean {
  return !resourceBindingMatchesSource(getAgentResourceBinding(session.resource_bindings, request.resource_reference.kind), request.source_resource)
}

export function terminalReferenceBindingKey(session: AgentSession, kind: AgentResourceKind = 'ssh_session'): string {
  const binding = getAgentResourceBinding(session.resource_bindings, kind)
  // 确认仅授权替换当时看到的关联；其他窗口更换关联后必须重新确认。
  return agentResourceBindingKey(binding)
}

export function validateTerminalReferenceText(request: AgentTerminalReferenceLaunch): void {
  const bytes = new TextEncoder().encode(request.text).byteLength
  if (!request.text.trim() || request.text.includes('\0') || bytes > 256 * 1024
    || request.origin.line_count !== request.text.split('\n').length
    || request.origin.source_session_id !== request.resource_reference.session_id
    || request.source_resource.session_id !== request.resource_reference.session_id) {
    throw new Error('AGENT_TERMINAL_REFERENCE_INVALID')
  }
}
