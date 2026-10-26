import { hostDesktopTargetKey, type HostDesktopSource, type HostDesktopTarget } from '#common/contracts'
import type { RemoteDesktopSession } from '#entities/remote-desktop'

export interface WorkflowTarget {
  mode: 'session' | 'profile' | 'host'
  host?: HostDesktopTarget
  id?: string
  connectionGeneration?: number
}

export function sessionTarget(sessions: Pick<RemoteDesktopSession, 'id' | 'connection_generation'>[], id?: string): WorkflowTarget {
  return { mode: 'session', id, connectionGeneration: sessions.find((session) => session.id === id)?.connection_generation }
}

export function isTargetAvailable(target: WorkflowTarget, sessions: Pick<RemoteDesktopSession, 'id' | 'connection_generation' | 'status'>[], profiles: { id: string }[] = [], sources: HostDesktopSource[] = []): boolean {
  if (target.mode === 'host') return !!target.host && sources.some(source => hostDesktopTargetKey(source.target) === hostDesktopTargetKey(target.host!))
  if (!target.id) return false
  if (target.mode === 'profile') return profiles.some((profile) => profile.id === target.id)
  const session = sessions.find((item) => item.id === target.id)
  return !!session && !!target.connectionGeneration && session.connection_generation === target.connectionGeneration && !['failed', 'stopping'].includes(session.status)
}
