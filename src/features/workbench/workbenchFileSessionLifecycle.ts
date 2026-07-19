import type { FileSession, Session } from '../../types/domain'

export interface SourceSessionContext {
  hostId: string
  status: Session['status']
}

export function buildSourceSessionContexts(sessions: Session[]) {
  const contexts = new Map<string, SourceSessionContext>()
  for (const session of sessions) {
    if (session.kind !== 'ssh' || !session.host_id) {
      continue
    }
    contexts.set(session.id, {
      hostId: session.host_id,
      status: session.status,
    })
  }
  return contexts
}

export function isCurrentSourceSession(
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
) {
  const source = contexts.get(sourceSessionId)
  return source?.status === 'connected' && source.hostId === hostId
}

export function canApplyCreatedFileSession(
  created: FileSession,
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
) {
  return isCurrentSourceSession(contexts, sourceSessionId, hostId)
    && created.source_session_id === sourceSessionId
    && created.host_id === hostId
}

export function shouldMaintainFileSessionEventStream(
  sourceStatus: Session['status'] | null,
  sourceEndedAt: string | undefined,
  fileSessionStatus: FileSession['status'] | null,
) {
  if (sourceStatus !== 'connected' || sourceEndedAt) {
    return false
  }
  return fileSessionStatus === 'connecting'
    || fileSessionStatus === 'connected'
    || fileSessionStatus === 'waiting_trust'
}
