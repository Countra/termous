import type { FileSession } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { Session } from '#entities/session'
import type { SSHAccessProfileReferences } from '#entities/ssh-access-profile'

export interface SSHProfileRuntimeUsage {
  terminalSessions: number
  fileSessions: number
  backgroundForwards: number
  remoteDesktopSessions: number
  total: number
}

const activeTerminalStatuses = new Set<Session['status']>([
  'connecting',
  'waiting_host_trust',
  'connected',
])

const activeFileStatuses = new Set<FileSession['status']>([
  'connecting',
  'waiting_trust',
  'connected',
])

const activeForwardStatuses = new Set<ForwardInstance['status']>([
  'starting',
  'waiting_host_trust',
  'running',
  'reconnecting',
  'stopping',
])

export function countSSHProfileRuntimeUsage(
  sshProfileId: string,
  sessions: readonly Session[],
  fileSessions: readonly FileSession[],
  forwards: readonly ForwardInstance[],
  remoteDesktopSessions: readonly RemoteDesktopSession[] = [],
): SSHProfileRuntimeUsage {
  if (!sshProfileId) {
    return {
      terminalSessions: 0,
      fileSessions: 0,
      backgroundForwards: 0,
      remoteDesktopSessions: 0,
      total: 0,
    }
  }
  const terminalSessions = sessions.filter((session) => (
    session.kind === 'ssh'
    && session.ssh_profile_id === sshProfileId
    && activeTerminalStatuses.has(session.status)
  )).length
  const matchedFileSessions = fileSessions.filter((session) => (
    session.ssh_profile_id === sshProfileId
    && activeFileStatuses.has(session.status)
  )).length
  const backgroundForwards = forwards.filter((forward) => (
    forward.scope !== 'session'
    && forward.ssh_profile_id === sshProfileId
    && activeForwardStatuses.has(forward.status)
  )).length
  // 远程桌面失败会话仍可手工重连，并持续持有 SSH Profile 租约，直到会话从运行时清单移除。
  const matchedRemoteDesktopSessions = remoteDesktopSessions.filter((session) => (
    session.ssh_profile_id === sshProfileId
  )).length
  return {
    terminalSessions,
    fileSessions: matchedFileSessions,
    backgroundForwards,
    remoteDesktopSessions: matchedRemoteDesktopSessions,
    total: terminalSessions + matchedFileSessions + backgroundForwards + matchedRemoteDesktopSessions,
  }
}

export function mergeSSHProfileRuntimeUsage(
  references: SSHAccessProfileReferences,
  local: SSHProfileRuntimeUsage,
): SSHProfileRuntimeUsage {
  const terminalSessions = Math.max(references.active_terminal_sessions ?? 0, local.terminalSessions)
  const fileSessions = Math.max(references.active_file_sessions ?? 0, local.fileSessions)
  const backgroundForwards = Math.max(
    references.active_background_forwards ?? 0,
    local.backgroundForwards,
  )
  const remoteDesktopSessions = Math.max(
    references.active_remote_desktop_sessions ?? 0,
    local.remoteDesktopSessions,
  )
  return {
    terminalSessions,
    fileSessions,
    backgroundForwards,
    remoteDesktopSessions,
    total: Math.max(
      references.active_total ?? 0,
      terminalSessions + fileSessions + backgroundForwards + remoteDesktopSessions,
    ),
  }
}
