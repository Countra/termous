export interface TerminalAIReferenceTarget {
  session_id: string
  title: string
  pinned?: boolean
  last_activity_at?: string
  disabled?: boolean
  disabled_reason?: 'binding_locked'
}

export interface TerminalAIReferenceSource {
  host_id: string
  host_name: string
  ssh_profile_id: string
  ssh_profile_name: string
  started_at: string
}

export interface TerminalAIReferenceSnapshot {
  canReference: boolean
  ready: boolean
  source?: TerminalAIReferenceSource
  targets: readonly TerminalAIReferenceTarget[]
}

export interface TerminalAIReferenceSelection {
  target: { kind: 'new' } | { kind: 'session'; session_id: string }
  selectionText: string
  sourceSessionId: string
  source: TerminalAIReferenceSource
  capturedAt: string
}

export interface TerminalAIReferenceProps {
  getAgentReferenceSnapshot?: (sourceSessionId: string) => TerminalAIReferenceSnapshot
  onReferenceTerminalSelection?: (selection: TerminalAIReferenceSelection) => void
}

export function freezeTerminalAIReferenceSnapshot(snapshot: TerminalAIReferenceSnapshot): TerminalAIReferenceSnapshot {
  return { ...snapshot, source: snapshot.source ? { ...snapshot.source } : undefined, targets: snapshot.targets.map((target) => ({ ...target })).sort((left, right) => (
    Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || activityTime(right.last_activity_at) - activityTime(left.last_activity_at)
    || left.session_id.localeCompare(right.session_id)
  )) }
}

function activityTime(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}
