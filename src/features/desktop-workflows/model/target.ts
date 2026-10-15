import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'

export interface WorkflowTarget {
  mode: 'session' | 'profile'
  id?: string
  connectionGeneration?: number
}

export function sessionTarget(sessions: RemoteDesktopSession[], id?: string): WorkflowTarget {
  return { mode: 'session', id, connectionGeneration: sessions.find((session) => session.id === id)?.connection_generation }
}

export function isTargetAvailable(target: WorkflowTarget, sessions: RemoteDesktopSession[], profiles: RemoteDesktopAccessProfile[] = []): boolean {
  if (!target.id) return false
  if (target.mode === 'profile') return profiles.some((profile) => profile.id === target.id)
  const session = sessions.find((item) => item.id === target.id)
  return !!session && !!target.connectionGeneration && session.connection_generation === target.connectionGeneration && !['failed', 'stopping'].includes(session.status)
}
