import type { Session } from '#entities/session'
import type { Host } from '#entities/host'
import type { CommandDispatchScope } from '#entities/command-dispatch'

export const maximumCommandDispatchTargets = 64
export const maximumCommandDispatchBytes = 8 * 1024
const commandTextEncoder = new TextEncoder()

export interface CommandDispatchSessionOption {
  sessionId: string
  sessionName: string
  hostName: string
  endpoint: string
  searchValue: string
}

export function connectedSSHSessionIds(sessions: readonly Session[]) {
  return sessions
    .filter(isConnectedSSHSession)
    .map((session) => session.id)
}

export function isConnectedSSHSession(session: Session) {
  return session.kind === 'ssh' && session.status === 'connected'
}

export function pruneCommandDispatchSelection(
  selectedSessionIds: ReadonlySet<string>,
  sessions: readonly Session[],
) {
  const eligible = new Set(connectedSSHSessionIds(sessions))
  return new Set([...selectedSessionIds].filter((sessionId) => eligible.has(sessionId)))
}

export function resolveCommandDispatchTargetIds(options: {
  scope: CommandDispatchScope
  sessions: readonly Session[]
  activeSessionId?: string
  selectedSessionIds: ReadonlySet<string>
}) {
  const eligibleIds = connectedSSHSessionIds(options.sessions)
  const eligible = new Set(eligibleIds)
  switch (options.scope) {
    case 'current':
      return options.activeSessionId && eligible.has(options.activeSessionId)
        ? [options.activeSessionId]
        : []
    case 'selected':
      return eligibleIds.filter((sessionId) => options.selectedSessionIds.has(sessionId))
    case 'all':
      return eligibleIds
  }
}

export function containsCommandLineBreak(value: string) {
  return /[\r\n]/.test(value)
}

export function commandDispatchUTF8ByteLength(value: string) {
  return commandTextEncoder.encode(value).byteLength
}

export function buildCommandDispatchSessionOptions(
  sessions: readonly Session[],
  hosts: readonly Host[],
  resolveSessionTitle: (session: Session) => string,
): CommandDispatchSessionOption[] {
  const hostsById = new Map(hosts.map((host) => [host.id, host]))
  return sessions.filter(isConnectedSSHSession).map((session) => {
    const host = session.host_id ? hostsById.get(session.host_id) : undefined
    const sessionName = resolveSessionTitle(session)
    const hostName = host?.name ?? ''
    const endpoint = host
      ? `${host.username}@${host.address}:${host.port}`
      : session.id
    return {
      sessionId: session.id,
      sessionName,
      hostName,
      endpoint,
      searchValue: `${sessionName}\n${hostName}\n${endpoint}`.toLocaleLowerCase(),
    }
  })
}
