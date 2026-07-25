import type {
  FileSession,
  ForwardInstance,
  Session,
} from '../../types/domain'
import type { UpdateRuntimeSummary } from '../../../electron/updateRuntime'

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
      forward.status === 'running'
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
