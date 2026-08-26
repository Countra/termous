import type { FileSession } from '#entities/file'
import type { Session } from '#entities/session'

export interface SSHProfileRuntimeUsage {
  terminalSessions: number
  fileSessions: number
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

export function countSSHProfileRuntimeUsage(
  sshProfileId: string,
  sessions: readonly Session[],
  fileSessions: readonly FileSession[],
): SSHProfileRuntimeUsage {
  if (!sshProfileId) {
    return { terminalSessions: 0, fileSessions: 0, total: 0 }
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
  return {
    terminalSessions,
    fileSessions: matchedFileSessions,
    total: terminalSessions + matchedFileSessions,
  }
}
