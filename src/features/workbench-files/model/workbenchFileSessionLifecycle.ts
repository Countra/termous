import type { FileSession } from '#entities/file'
import type { Session } from '#entities/session'
import { isOlderFileSessionSnapshot } from '#entities/file'
import {
  isFileSessionRecoverySupersededError,
  resolveFileSessionClosure,
  type FileSessionClosureState,
} from '#entities/file'

export type FileSessionRecoveryPhase = 'idle' | 'required' | 'requesting' | 'waiting_ready' | 'failed'

export interface FileSessionRecoveryState {
  phase: FileSessionRecoveryPhase
  transaction: number
  sessionId: string
  connectionGeneration?: number
  errorCode: string
  terminated: boolean
}

export const idleFileSessionRecoveryState: FileSessionRecoveryState = {
  phase: 'idle',
  transaction: 0,
  sessionId: '',
  errorCode: '',
  terminated: false,
}

const recoveryNotificationSourceLimit = 32
const recoveryNotificationTransactionLimit = 4

export function shouldNotifyFileSessionRecoveryFailure(
  notifiedTransactionsBySource: Map<string, Set<number>>,
  sourceSessionId: string | null | undefined,
  recovery: Pick<FileSessionRecoveryState, 'phase' | 'transaction'>,
) {
  if (!sourceSessionId) {
    return false
  }
  if (recovery.phase === 'idle') {
    notifiedTransactionsBySource.delete(sourceSessionId)
    return false
  }
  if (recovery.phase !== 'failed') {
    return false
  }

  let notifiedTransactions = notifiedTransactionsBySource.get(sourceSessionId)
  if (!notifiedTransactions) {
    notifiedTransactions = new Set<number>()
  } else {
    notifiedTransactionsBySource.delete(sourceSessionId)
  }
  notifiedTransactionsBySource.set(sourceSessionId, notifiedTransactions)

  if (notifiedTransactions.has(recovery.transaction)) {
    return false
  }
  notifiedTransactions.add(recovery.transaction)

  while (notifiedTransactions.size > recoveryNotificationTransactionLimit) {
    const oldestTransaction = notifiedTransactions.values().next().value
    if (oldestTransaction === undefined) {
      break
    }
    notifiedTransactions.delete(oldestTransaction)
  }
  while (notifiedTransactionsBySource.size > recoveryNotificationSourceLimit) {
    const oldestSource = notifiedTransactionsBySource.keys().next().value
    if (oldestSource === undefined) {
      break
    }
    notifiedTransactionsBySource.delete(oldestSource)
  }
  return true
}

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
  if (override.id === persisted.id) {
    const versioned = newerFileSessionSnapshot(override, persisted)
    if (versioned) {
      return versioned
    }
  }
  const overrideTime = Date.parse(override.connected_at ?? override.started_at)
  const persistedTime = Date.parse(persisted.connected_at ?? persisted.started_at)
  return overrideTime >= persistedTime ? override : persisted
}

export function resolveSourceFileSessionWithClosure(
  sourceAvailable: boolean,
  override: FileSession | undefined,
  persisted: FileSession | undefined,
  closure: FileSessionClosureState | undefined,
) {
  if (!closure) {
    return resolveSourceFileSession(sourceAvailable, override, persisted)
  }
  if (!sourceAvailable) {
    return null
  }

  // 全局列表中的不同 ID 表示已经建立了真实替代会话，旧 closure 不再具有身份权威性。
  if (persisted && persisted.id !== closure.session.id) {
    return resolveSourceFileSession(
      true,
      override?.id === persisted.id ? override : undefined,
      persisted,
    )
  }

  // keepalive 暂停期间可能遗留更旧 ID 的本地快照，只允许 closure 对应 ID 参与合并。
  const resolved = resolveSourceFileSession(
    true,
    override?.id === closure.session.id ? override : undefined,
    persisted?.id === closure.session.id ? persisted : undefined,
  )
  return resolveFileSessionClosure(resolved, closure)
}

export function selectCurrentFileSessionSnapshot(
  authoritative: FileSession | undefined,
  override: FileSession | undefined,
  persisted: FileSession | undefined,
) {
  return authoritative ?? override ?? persisted
}

function newerFileSessionSnapshot(left: FileSession, right: FileSession) {
  const leftGeneration = left.connection_generation
  const rightGeneration = right.connection_generation
  if (leftGeneration !== undefined || rightGeneration !== undefined) {
    if (leftGeneration === undefined) return right
    if (rightGeneration === undefined) return left
    if (leftGeneration !== rightGeneration) {
      return leftGeneration > rightGeneration ? left : right
    }
  }
  const leftSequence = left.state_seq
  const rightSequence = right.state_seq
  if (leftSequence !== undefined || rightSequence !== undefined) {
    if (leftSequence === undefined) return right
    if (rightSequence === undefined) return left
    if (leftSequence !== rightSequence) {
      return leftSequence > rightSequence ? left : right
    }
    return left
  }
  if (leftGeneration !== undefined || rightGeneration !== undefined) {
    return left
  }
  return null
}

export function mergeFileSessionUpdate(
  current: FileSession | null | undefined,
  next: FileSession,
  resetProgress = false,
  allowSessionChange = false,
) {
  if (current && current.id !== next.id && !allowSessionChange) {
    return current
  }
  if (current?.id === next.id && isOlderFileSessionSnapshot(current, next)) {
    return current
  }
  const generationChanged = current?.id === next.id
    && current.connection_generation !== undefined
    && next.connection_generation !== undefined
    && current.connection_generation !== next.connection_generation
  const nextProgress = normalizeFileSessionProgress(next.progress)
  if (!current || current.id !== next.id || resetProgress || generationChanged) {
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

export function resolveFileSessionUpdate(
  current: FileSession | null | undefined,
  next: FileSession,
  resetProgress = false,
  allowSessionChange = false,
) {
  const session = mergeFileSessionUpdate(
    current,
    next,
    resetProgress,
    allowSessionChange,
  )
  return {
    accepted: !current || session !== current,
    session,
  }
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
  enabled = true,
) {
  if (!enabled || sourceClosing || sourceStatus !== 'connected' || sourceEndedAt) {
    return false
  }
  return fileSessionStatus === 'connecting'
    || fileSessionStatus === 'connected'
    || fileSessionStatus === 'waiting_trust'
}

export function requireFileSessionRecovery(
  current: FileSessionRecoveryState,
  session: FileSession,
  terminated: boolean,
): FileSessionRecoveryState {
  if (
    current.phase === 'required'
    && current.sessionId === session.id
    && current.terminated === terminated
    && current.errorCode === (session.error_code || '')
  ) {
    return current
  }
  return {
    phase: 'required',
    transaction: current.transaction + 1,
    sessionId: session.id,
    connectionGeneration: session.connection_generation,
    errorCode: session.error_code || '',
    terminated,
  }
}

export function beginFileSessionRecovery(
  current: FileSessionRecoveryState,
  sessionId: string,
  terminated: boolean,
): FileSessionRecoveryState {
  return {
    phase: 'requesting',
    transaction: current.transaction + 1,
    sessionId,
    connectionGeneration: undefined,
    errorCode: '',
    terminated,
  }
}

export function waitForFileSessionRecovery(
  current: FileSessionRecoveryState,
  session: FileSession,
): FileSessionRecoveryState {
  return {
    ...current,
    phase: 'waiting_ready',
    sessionId: session.id,
    connectionGeneration: session.connection_generation,
    errorCode: '',
    terminated: false,
  }
}

export function failFileSessionRecovery(
  current: FileSessionRecoveryState,
  errorCode: string,
): FileSessionRecoveryState {
  return {
    ...current,
    phase: 'failed',
    errorCode,
  }
}

export function markFileSessionRecoveryTerminated(
  current: FileSessionRecoveryState,
  sessionId: string,
) {
  return {
    ...current,
    sessionId,
    terminated: true,
  }
}

export function fileSessionRecoveryMethod(
  session: FileSession | null | undefined,
  recovery: FileSessionRecoveryState,
) {
  return !session
    || isTerminatedFileSession(session)
    || (recovery.sessionId === session.id && recovery.terminated)
    ? 'create' as const
    : 'reconnect' as const
}

export function isTerminatedFileSession(session: FileSession | null | undefined) {
  return session?.error_code === 'SFTP_FILE_SESSION_NOT_FOUND'
}

export function canRetryFileSessionRecovery(
  session: FileSession | null | undefined,
  recovery: FileSessionRecoveryState,
  initialError = false,
) {
  const actionable = recovery.phase === 'required'
    || recovery.phase === 'failed'
    || (!session && initialError)
  return actionable && (
    recovery.terminated
    || isTerminatedFileSession(session)
    || session?.retryable !== false
  )
}

export function fileSessionRecoveryPresentationKind(
  session: FileSession | null | undefined,
  recovery: FileSessionRecoveryState,
  initialError = false,
) {
  if (recovery.phase === 'requesting') return 'recovering' as const
  if (recovery.phase === 'waiting_ready' && session?.status === 'waiting_trust') return 'waiting_trust' as const
  if (recovery.phase === 'waiting_ready') return 'recovering' as const
  if (recovery.phase === 'failed') return 'recovery_failed' as const
  if (recovery.terminated) return 'terminated' as const
  if (session?.status === 'disconnected') return 'disconnected' as const
  if (session?.status === 'failed' || initialError) return 'connect_failed' as const
  if (session?.status === 'waiting_trust') return 'waiting_trust' as const
  if (session?.phase) return 'connecting_phase' as const
  return 'connecting' as const
}

export function reconcileDisconnectedFileSessionRecovery(
  current: FileSessionRecoveryState,
  session: FileSession,
) {
  const sameSession = current.sessionId === session.id
  const terminated = isTerminatedFileSession(session) || (sameSession && current.terminated)
  if (sameSession && current.phase === 'requesting') {
    return current
  }
  if (sameSession && current.phase === 'waiting_ready') {
    if (
      current.connectionGeneration !== undefined
      && session.connection_generation !== undefined
      && session.connection_generation < current.connectionGeneration
    ) {
      return current
    }
    return failFileSessionRecovery(
      terminated ? { ...current, terminated: true } : current,
      session.error_code || 'SFTP_RECONNECT_FAILED',
    )
  }
  if (sameSession && current.phase === 'failed' && current.terminated === terminated) {
    return current
  }
  return requireFileSessionRecovery(current, session, terminated)
}

export function completeFileSessionRecovery(
  current: FileSessionRecoveryState,
): FileSessionRecoveryState {
  return {
    ...idleFileSessionRecoveryState,
    transaction: current.transaction,
  }
}

export function cancelSupersededFileSessionRecovery(
  current: FileSessionRecoveryState,
  expectedTransaction: number,
  authoritativeSession: FileSession | null | undefined,
  terminated: boolean,
) {
  if (current.transaction !== expectedTransaction) {
    return current
  }
  const completed = completeFileSessionRecovery(current)
  if (
    !authoritativeSession
    || (
      authoritativeSession.status !== 'failed'
      && authoritativeSession.status !== 'disconnected'
      && !terminated
    )
  ) {
    return completed
  }
  return requireFileSessionRecovery(completed, authoritativeSession, terminated)
}

export function isRecoveredFileSessionReady(
  recovery: FileSessionRecoveryState,
  session: FileSession | null | undefined,
) {
  if (recovery.phase !== 'waiting_ready' || !session || session.status !== 'connected') {
    return false
  }
  if (recovery.sessionId !== session.id) {
    return false
  }
  return recovery.connectionGeneration === undefined
    || session.connection_generation === undefined
    || recovery.connectionGeneration === session.connection_generation
}

export function canCompleteFileSessionRecovery(
  current: FileSessionRecoveryState,
  expectedTransaction: number,
  expectedSessionId: string,
  expectedConnectionGeneration: number | undefined,
  authoritativeSession: FileSession | null | undefined,
) {
  if (
    current.transaction !== expectedTransaction
    || current.phase !== 'waiting_ready'
    || current.sessionId !== expectedSessionId
    || !authoritativeSession
    || authoritativeSession.id !== expectedSessionId
    || authoritativeSession.status !== 'connected'
  ) {
    return false
  }
  const authoritativeGeneration = authoritativeSession.connection_generation
  if (expectedConnectionGeneration !== undefined || authoritativeGeneration !== undefined) {
    return expectedConnectionGeneration === authoritativeGeneration
      && current.connectionGeneration === authoritativeGeneration
  }
  return current.connectionGeneration === undefined
}

export function shouldCreateFileSessionAfterReconnect(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const value = error as { code?: unknown }
  return value.code === 'SFTP_FILE_SESSION_NOT_FOUND'
}

export function shouldSilentlyCancelFileSessionRecovery(error: unknown) {
  return isFileSessionRecoverySupersededError(error)
}

export function runSingleFileSessionRecovery(
  pendingBySource: Map<string, Promise<void>>,
  sourceSessionId: string,
  start: () => Promise<void>,
) {
  const existing = pendingBySource.get(sourceSessionId)
  if (existing) {
    return existing
  }
  const pending = start()
  pendingBySource.set(sourceSessionId, pending)
  const clear = () => {
    if (pendingBySource.get(sourceSessionId) === pending) {
      pendingBySource.delete(sourceSessionId)
    }
  }
  void pending.then(clear, clear)
  return pending
}

export function pruneFileSessionRecoveries(
  pendingBySource: Map<string, Promise<void>>,
  activeSourceSessionIds: ReadonlySet<string>,
) {
  for (const sourceSessionId of pendingBySource.keys()) {
    if (!activeSourceSessionIds.has(sourceSessionId)) {
      pendingBySource.delete(sourceSessionId)
    }
  }
}
