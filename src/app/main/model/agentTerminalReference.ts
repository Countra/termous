import { sameTerminalReferenceSource, type AgentReferenceTargetsSnapshot, type AgentSSHResourceState, type AgentTerminalReferenceLaunch } from '#entities/agent'
import type { TerminalAIReferenceSelection, TerminalAIReferenceSnapshot } from '#features/terminal'

export function projectTerminalAIReferenceSnapshot(
  sourceSessionId: string,
  resources: AgentSSHResourceState[],
  sessions: AgentReferenceTargetsSnapshot,
  resourcesReady: boolean,
): TerminalAIReferenceSnapshot {
  const source = resources.find(({ session_id }) => session_id === sourceSessionId)
  return {
    ready: resourcesReady && sessions.ready,
    canReference: resourcesReady && source?.status === 'ready',
    source,
    targets: sessions.targets.map((target) => {
      const same = target.resource_binding?.session_id === sourceSessionId
        && target.resource_binding.host_id === source?.host_id
        && target.resource_binding.ssh_profile_id === source?.ssh_profile_id
      const disabled = target.binding_locked && !same
      return {
        session_id: target.session_id,
        title: target.title,
        pinned: target.pinned,
        last_activity_at: target.last_activity_at,
        disabled,
        disabled_reason: disabled ? 'binding_locked' : undefined,
      }
    }),
  }
}

export function buildTerminalReferenceLaunch(
  selection: TerminalAIReferenceSelection,
  resources: AgentSSHResourceState[],
): AgentTerminalReferenceLaunch {
  const captured: AgentSSHResourceState = { ...selection.source, session_id: selection.sourceSessionId, status: 'ready' }
  const live = resources.find(({ session_id }) => session_id === selection.sourceSessionId)
  if (!sameTerminalReferenceSource(captured, live)) throw new Error('AGENT_TERMINAL_REFERENCE_SOURCE_UNAVAILABLE')
  const text = selection.selectionText
  if (!text.trim() || text.includes('\0') || new TextEncoder().encode(text).byteLength > 256 * 1024) {
    throw new Error('AGENT_TERMINAL_REFERENCE_INVALID')
  }
  return {
    source: 'terminal_selection',
    target: selection.target,
    text,
    source_resource: captured,
    resource_reference: { kind: 'ssh_session', session_id: selection.sourceSessionId },
    origin: {
      kind: 'terminal_selection',
      source_session_id: selection.sourceSessionId,
      host_name: selection.source.host_name,
      captured_at: selection.capturedAt,
      line_count: text.split('\n').length,
    },
  }
}
