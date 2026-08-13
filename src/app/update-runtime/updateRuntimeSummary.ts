import type { FileSession } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { Session } from '#entities/session'
import type { UpdateRuntimeSummary } from '#common/contracts'

export function buildUpdateRuntimeSummary(input: {
  activeTransferCount: number
  fileSessions: FileSession[]
  forwards: ForwardInstance[]
  sessions: Session[]
  transferSnapshotComplete: boolean
}): UpdateRuntimeSummary {
  return {
    ssh_sessions: clampRuntimeCount(input.sessions.filter((session) => (
      session.kind === 'ssh'
      && (session.status === 'connecting' || session.status === 'connected')
    )).length),
    file_sessions: clampRuntimeCount(input.fileSessions.filter((session) => (
      session.status === 'connecting'
      || session.status === 'connected'
      || session.status === 'waiting_trust'
    )).length),
    forwards: clampRuntimeCount(input.forwards.filter((forward) => (
      forward.status === 'starting'
      || forward.status === 'waiting_host_trust'
      || forward.status === 'running'
      || forward.status === 'stopping'
    )).length),
    transfers: clampRuntimeCount(input.activeTransferCount),
    transfers_complete: input.transferSnapshotComplete,
  }
}

function clampRuntimeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(100_000, value)
    : 0
}
