import type { RemoteDesktopSession } from '#entities/remote-desktop'

export interface WorkflowTarget {
  mode: 'session' | 'profile'
  id?: string
  connectionGeneration?: number
}

export function sessionTarget(sessions: Pick<RemoteDesktopSession, 'id' | 'connection_generation'>[], id?: string): WorkflowTarget {
  return { mode: 'session', id, connectionGeneration: sessions.find((session) => session.id === id)?.connection_generation }
}

export function isTargetAvailable(target: WorkflowTarget, sessions: Pick<RemoteDesktopSession, 'id' | 'connection_generation' | 'status'>[], profiles: { id: string }[] = []): boolean {
  if (!target.id) return false
  if (target.mode === 'profile') return profiles.some((profile) => profile.id === target.id)
  const session = sessions.find((item) => item.id === target.id)
  return !!session && !!target.connectionGeneration && session.connection_generation === target.connectionGeneration && !['failed', 'stopping'].includes(session.status)
}
