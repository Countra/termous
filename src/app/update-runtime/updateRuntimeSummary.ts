import type { FileSession } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { Session } from '#entities/session'
import type { UpdateRuntimeSummary } from '#common/contracts'

export function buildUpdateRuntimeSummary(input: {
  activeTransferCount: number
  agentRunCount: number
  fileSessions: FileSession[]
  forwards: ForwardInstance[]
  sessions: Session[]
  remoteDesktopCount: number
  runtimeSnapshotComplete: boolean
}): UpdateRuntimeSummary {
  return {
    agent_runs: clampRuntimeCount(input.agentRunCount),
    ssh_sessions: clampRuntimeCount(input.sessions.filter((session) => (
      session.kind === 'ssh'
      && (
        session.status === 'connecting'
        || session.status === 'waiting_host_trust'
        || session.status === 'connected'
      )
    )).length),
    remote_desktop_sessions: clampRuntimeCount(input.remoteDesktopCount),
    file_sessions: clampRuntimeCount(input.fileSessions.filter((session) => (
      session.status === 'connecting'
      || session.status === 'connected'
      || session.status === 'waiting_trust'
    )).length),
    forwards: clampRuntimeCount(input.forwards.filter((forward) => (
      forward.status === 'starting'
      || forward.status === 'waiting_host_trust'
      || forward.status === 'running'
      || forward.status === 'reconnecting'
      || forward.status === 'stopping'
    )).length),
    transfers: clampRuntimeCount(input.activeTransferCount),
    // 保留既有协议字段名，其值表示所有 Renderer 运行态快照均已完成对账。
    transfers_complete: input.runtimeSnapshotComplete,
  }
}

function clampRuntimeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(100_000, value)
    : 0
}
