import type { FileSession } from '../../types/domain'

export type FileSessionRecoveryAttemptPhase = 'requesting' | 'waiting_ready'

export interface FileSessionRecoveryAttempt {
  originalSessionId: string
  targetSessionId: string
  phase: FileSessionRecoveryAttemptPhase
  connectionGeneration?: number
}

export interface FileSessionClosureState {
  session: FileSession
  phase: 'closing' | 'closed'
}

export interface FileSessionDirectoryCacheOwner {
  fileSessionId: string
  hostId: string
  sourceSessionId: string
}

export interface FileSessionRecoveryOperation {
  fileSessionId: string
  closeEpoch: number
}

export class FileSessionRecoverySupersededError extends Error {
  readonly code = 'SFTP_RECOVERY_SUPERSEDED'
  readonly fileSessionId: string
  readonly cleanupError?: unknown

  constructor(fileSessionId: string, cleanupError?: unknown) {
    super('file session recovery was superseded by an explicit close')
    this.name = 'FileSessionRecoverySupersededError'
    this.fileSessionId = fileSessionId
    this.cleanupError = cleanupError
  }
}

export type FileSessionRecoveryOutcome = 'pending' | 'succeeded' | 'failed'

export function isTerminatedFileSession(session: FileSession) {
  return session.error_code === 'SFTP_FILE_SESSION_NOT_FOUND'
}

export function fileSessionRecoveryRequestMethod(session: FileSession) {
  return isTerminatedFileSession(session) ? 'create' as const : 'reconnect' as const
}

export function shouldCreateFileSessionAfterReconnect(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'SFTP_FILE_SESSION_NOT_FOUND',
  )
}

export function beginFileSessionRecoveryOperation(
  closeEpochs: ReadonlyMap<string, number>,
  fileSessionId: string,
): FileSessionRecoveryOperation {
  return {
    fileSessionId,
    closeEpoch: closeEpochs.get(fileSessionId) ?? 0,
  }
}

export function supersedeFileSessionRecovery(
  closeEpochs: Map<string, number>,
  fileSessionId: string,
) {
  closeEpochs.set(fileSessionId, (closeEpochs.get(fileSessionId) ?? 0) + 1)
}

export function supersedeQueuedFileSessionRecovery(
  closeEpochs: Map<string, number>,
  pendingBySession: ReadonlyMap<string, Promise<void>>,
  fileSessionId: string,
) {
  supersedeFileSessionRecovery(closeEpochs, fileSessionId)
  if (!pendingBySession.has(fileSessionId)) {
    closeEpochs.delete(fileSessionId)
  }
}

export function isFileSessionRecoveryOperationCurrent(
  closeEpochs: ReadonlyMap<string, number>,
  operation: FileSessionRecoveryOperation,
) {
  return (closeEpochs.get(operation.fileSessionId) ?? 0) === operation.closeEpoch
}

export function isFileSessionRecoverySupersededError(error: unknown) {
  return error instanceof FileSessionRecoverySupersededError
    || Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'SFTP_RECOVERY_SUPERSEDED',
    )
}

export async function runFileSessionRecoveryOperation<Result>(
  closeEpochs: ReadonlyMap<string, number>,
  fileSessionId: string,
  request: () => Promise<Result>,
  disposeSupersededResult?: (result: Result) => Promise<void>,
) {
  const operation = beginFileSessionRecoveryOperation(closeEpochs, fileSessionId)
  return executeFileSessionRecoveryOperation(
    closeEpochs,
    operation,
    request,
    disposeSupersededResult,
  )
}

export function runQueuedFileSessionRecoveryOperation<Result>(
  closeEpochs: ReadonlyMap<string, number>,
  pendingBySession: Map<string, Promise<void>>,
  fileSessionId: string,
  request: () => Promise<Result>,
  disposeSupersededResult?: (result: Result) => Promise<void>,
  onQueueIdle?: (fileSessionId: string) => void,
) {
  const operation = beginFileSessionRecoveryOperation(closeEpochs, fileSessionId)
  const previous = pendingBySession.get(fileSessionId) ?? Promise.resolve()
  const result = previous.then(() => {
    if (!isFileSessionRecoveryOperationCurrent(closeEpochs, operation)) {
      throw new FileSessionRecoverySupersededError(fileSessionId)
    }
    return executeFileSessionRecoveryOperation(
      closeEpochs,
      operation,
      request,
      disposeSupersededResult,
    )
  })
  const completion = result.then(
    () => undefined,
    () => undefined,
  )
  pendingBySession.set(fileSessionId, completion)
  void completion.then(() => {
    if (pendingBySession.get(fileSessionId) === completion) {
      pendingBySession.delete(fileSessionId)
      onQueueIdle?.(fileSessionId)
    }
  })
  return result
}

async function executeFileSessionRecoveryOperation<Result>(
  closeEpochs: ReadonlyMap<string, number>,
  operation: FileSessionRecoveryOperation,
  request: () => Promise<Result>,
  disposeSupersededResult?: (result: Result) => Promise<void>,
) {
  let result: Result
  try {
    result = await request()
  } catch (error) {
    if (!isFileSessionRecoveryOperationCurrent(closeEpochs, operation)) {
      throw new FileSessionRecoverySupersededError(operation.fileSessionId)
    }
    throw error
  }
  if (isFileSessionRecoveryOperationCurrent(closeEpochs, operation)) {
    return result
  }
  let cleanupError: unknown
  try {
    await disposeSupersededResult?.(result)
  } catch (error) {
    cleanupError = error
  }
  throw new FileSessionRecoverySupersededError(operation.fileSessionId, cleanupError)
}

export function filterSuppressedFileSessions(
  sessions: FileSession[],
  suppressedBySessionId: ReadonlyMap<string, string>,
) {
  return sessions.filter((session) => !suppressedBySessionId.has(session.id))
}

export function suppressFileSessionRecoveryResult(
  suppressedBySessionId: Map<string, string>,
  fileSessionId: string,
  originalSessionId: string,
) {
  suppressedBySessionId.set(fileSessionId, originalSessionId)
}

export function adoptSuppressedFileSessionRecoveryResult(
  suppressedBySessionId: Map<string, string>,
  fileSessionId: string,
) {
  suppressedBySessionId.delete(fileSessionId)
}

export async function cleanupSuppressedFileSessionRecoveryResult(
  suppressedBySessionId: Map<string, string>,
  fileSessionId: string,
  originalSessionId: string,
  cleanup: () => Promise<void>,
) {
  if (suppressedBySessionId.get(fileSessionId) !== originalSessionId) {
    return false
  }
  try {
    await cleanup()
  } catch (error) {
    if (!shouldCreateFileSessionAfterReconnect(error)) {
      throw error
    }
  }
  if (suppressedBySessionId.get(fileSessionId) === originalSessionId) {
    suppressedBySessionId.delete(fileSessionId)
  }
  return true
}

export function canRecoverFileSession(session: FileSession) {
  return isTerminatedFileSession(session) || session.retryable !== false
}

export function selectFileSessionForNavigation(
  sessions: FileSession[],
  hostId: string,
  sourceSessionId = '',
) {
  let selected: FileSession | undefined
  let selectedPriority = Number.POSITIVE_INFINITY
  for (const session of sessions) {
    if (
      session.host_id !== hostId
      || (sourceSessionId && session.source_session_id !== sourceSessionId)
    ) {
      continue
    }
    const priority = fileSessionNavigationPriority(session)
    if (priority < selectedPriority) {
      selected = session
      selectedPriority = priority
    }
  }
  return selected
}

export function selectFileSessionNavigationTarget(
  sessions: FileSession[],
  closures: Readonly<Record<string, FileSessionClosureState>>,
  hostId: string,
  sourceSessionId: string,
) {
  return selectFileSessionForNavigation(sessions, hostId, sourceSessionId)
    ?? resolveFileSessionClosure(null, closures[sourceSessionId])
}

export function includeActiveFileSessionClosure(
  sessions: FileSession[],
  closures: Readonly<Record<string, FileSessionClosureState>>,
  activeFileSessionId: string,
) {
  if (!activeFileSessionId || sessions.some((session) => session.id === activeFileSessionId)) {
    return sessions
  }
  const closure = Object.values(closures).find(
    (candidate) => candidate.session.id === activeFileSessionId,
  )
  const snapshot = resolveFileSessionClosure(null, closure)
  return snapshot ? [snapshot, ...sessions] : sessions
}

export function selectFileSessionCloseFallback(
  sessions: FileSession[],
  closures: Readonly<Record<string, FileSessionClosureState>>,
  unavailableSessionIds: ReadonlySet<string>,
) {
  const availableSession = sessions.find((session) => !unavailableSessionIds.has(session.id))
  if (availableSession) {
    return availableSession.id
  }
  for (const closure of Object.values(closures)) {
    if (!unavailableSessionIds.has(closure.session.id)) {
      return closure.session.id
    }
  }
  return ''
}

export function selectActiveFileSessionAfterConnect(
  currentSessionId: string,
  connectedSessionId: string,
  replacedSessionId = '',
) {
  if (!replacedSessionId) {
    return connectedSessionId
  }
  return currentSessionId === replacedSessionId ? connectedSessionId : currentSessionId
}

export function pruneRetiredFileSessionIds(
  retiredSessionIds: Set<string>,
  sessions: FileSession[],
  closures: Readonly<Record<string, FileSessionClosureState>>,
) {
  const retainedIds = new Set(sessions.map((session) => session.id))
  Object.values(closures).forEach((closure) => retainedIds.add(closure.session.id))
  for (const fileSessionId of retiredSessionIds) {
    if (!retainedIds.has(fileSessionId)) {
      retiredSessionIds.delete(fileSessionId)
    }
  }
}

function fileSessionNavigationPriority(session: FileSession) {
  switch (session.status) {
    case 'connected':
      return 0
    case 'connecting':
    case 'waiting_trust':
      return 1
    case 'disconnected':
      return 2
    case 'failed':
      return 3
  }
}

export function findFileSessionRecoveryAttempt(
  attempts: ReadonlyMap<string, FileSessionRecoveryAttempt>,
  sessionId: string,
) {
  for (const attempt of attempts.values()) {
    if (attempt.originalSessionId === sessionId || attempt.targetSessionId === sessionId) {
      return attempt
    }
  }
  return undefined
}

export function cancelFileSessionRecoveryAttempt(
  attempts: Map<string, FileSessionRecoveryAttempt>,
  sessionId: string,
) {
  let changed = false
  for (const [originalSessionId, attempt] of attempts) {
    if (attempt.originalSessionId !== sessionId && attempt.targetSessionId !== sessionId) {
      continue
    }
    attempts.delete(originalSessionId)
    changed = true
  }
  return changed
}

export function fileSessionDirectoryCacheOwner(
  session: FileSession,
): FileSessionDirectoryCacheOwner {
  return {
    fileSessionId: session.id,
    hostId: session.host_id,
    sourceSessionId: session.source_session_id ?? '',
  }
}

export function canReuseFileSessionDirectoryCache(
  owner: FileSessionDirectoryCacheOwner,
  session: FileSession,
  attempts: ReadonlyMap<string, FileSessionRecoveryAttempt>,
) {
  if (owner.fileSessionId === session.id) {
    return true
  }
  const attempt = findFileSessionRecoveryAttempt(attempts, session.id)
  if (
    attempt
    && attempt.originalSessionId === owner.fileSessionId
    && (attempt.targetSessionId === session.id || attempt.targetSessionId === attempt.originalSessionId)
  ) {
    return true
  }
  return Boolean(
    owner.sourceSessionId
    && owner.hostId === session.host_id
    && owner.sourceSessionId === session.source_session_id,
  )
}

export function fileSessionRecoveryOutcome(
  attempt: FileSessionRecoveryAttempt,
  session: FileSession | undefined,
): FileSessionRecoveryOutcome {
  if (attempt.phase !== 'waiting_ready' || !session || session.id !== attempt.targetSessionId) {
    return 'pending'
  }
  if (
    attempt.connectionGeneration !== undefined
    && session.connection_generation !== undefined
    && session.connection_generation < attempt.connectionGeneration
  ) {
    return 'pending'
  }
  if (session.status === 'connected') {
    return 'succeeded'
  }
  if (session.status === 'failed' || session.status === 'disconnected') {
    return 'failed'
  }
  return 'pending'
}

export function terminatedFileSessionSnapshot(session: FileSession): FileSession {
  return {
    ...session,
    status: 'failed',
    phase: 'failed',
    progress: undefined,
    status_message: '',
    last_error: '',
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
    retryable: true,
    state_seq: session.state_seq === undefined ? undefined : session.state_seq + 1,
  }
}

export function resolveFileSessionClosure(
  session: FileSession | null,
  closure: FileSessionClosureState | undefined,
) {
  if (!closure || (session && session.id !== closure.session.id)) {
    return session
  }
  const snapshot = session ?? closure.session
  return closure.phase === 'closed'
    ? terminatedFileSessionSnapshot(snapshot)
    : snapshot
}
