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

export function canUseSourceFileSession(
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
  closingSourceSessionIds: ReadonlySet<string>,
) {
  return !closingSourceSessionIds.has(sourceSessionId)
    && isCurrentSourceSession(contexts, sourceSessionId, hostId)
}

export function resolveSourceFileSession(
  sourceAvailable: boolean,
  override: FileSession | undefined,
  persisted: FileSession | undefined,
) {
  if (!sourceAvailable) {
    return null
  }
  if (!override) {
    return persisted ?? null
  }
  if (!persisted) {
    return override
  }
  const overrideTime = Date.parse(override.connected_at ?? override.started_at)
  const persistedTime = Date.parse(persisted.connected_at ?? persisted.started_at)
  return overrideTime >= persistedTime ? override : persisted
}

export function mergeFileSessionUpdate(
  current: FileSession | null | undefined,
  next: FileSession,
  resetProgress = false,
) {
  const nextProgress = normalizeFileSessionProgress(next.progress)
  if (!current || current.id !== next.id || resetProgress) {
    return nextProgress === next.progress ? next : { ...next, progress: nextProgress }
  }
  if (isSettledFileSession(current.status) && isPendingFileSession(next.status)) {
    return current
  }
  const currentProgress = normalizeFileSessionProgress(current.progress)
  const progress = nextProgress === undefined
    ? currentProgress
    : currentProgress === undefined
      ? nextProgress
      : Math.max(currentProgress, nextProgress)
  return progress === next.progress ? next : { ...next, progress }
}

function normalizeFileSessionProgress(progress: number | undefined) {
  if (progress === undefined || !Number.isFinite(progress)) {
    return undefined
  }
  return Math.max(0, Math.min(100, progress))
}

function isSettledFileSession(status: FileSession['status']) {
  return status === 'connected' || status === 'disconnected' || status === 'failed'
}

function isPendingFileSession(status: FileSession['status']) {
  return status === 'connecting' || status === 'waiting_trust'
}

export function shouldMaintainFileSessionEventStream(
  sourceStatus: Session['status'] | null,
  sourceEndedAt: string | undefined,
  fileSessionStatus: FileSession['status'] | null,
  sourceClosing = false,
) {
  if (sourceClosing || sourceStatus !== 'connected' || sourceEndedAt) {
    return false
  }
  return fileSessionStatus === 'connecting'
    || fileSessionStatus === 'connected'
    || fileSessionStatus === 'waiting_trust'
}
