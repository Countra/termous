import type {
  RemoteDirectoryListing,
  SessionCwdState,
} from '../../types/domain.ts'
import { normalizeRemotePath, normalizeRemotePosixPath } from '#shared/path'
import type { TerminalTransportState } from '#features/terminal'

export type SessionFilesSyncStatus =
  | ''
  | 'queued'
  | 'waiting-idle'
  | 'publishing'
  | 'applying'
  | 'failed'
  | 'unsupported'
  | 'reconnect-required'
  | 'preparing'
  | 'locating'
  | 'not_ready'
  | 'invalid_path'

export interface SessionFilesCwdRequestError {
  code: string
  message: string
}

export interface SessionFilesDerivedSyncState {
  status: SessionFilesSyncStatus
  error: string
}

export type SessionFilesCwdRefreshPhase = 'idle' | 'waiting' | 'pending' | 'failed'

export interface SessionFilesCwdRefreshTransaction {
  phase: SessionFilesCwdRefreshPhase
  transactionSequence: number
  requestId: string
  baseRefreshSequence: number
  baseConfirmedPath: string
  baseSourceGeneration: number
  startedAt: number
  deadlineAt: number
  retryCount: number
  recoveryRetryCount: number
  retryAt: number
  error: string
}

export type SessionFilesCwdRefreshTransportDisposition = 'wait' | 'ready' | 'failed'

export interface SessionFilesCwdRefreshBaseline {
  requestId?: string
  baseRefreshSequence: number
  baseConfirmedPath: string
}

export const sessionFilesCwdRefreshWatchdogTimeoutMs = 65_000
export const sessionFilesCwdLocalRetryDelayMs = 250
export const sessionFilesCwdRefreshRecoveryRetryLimit = 3
const sessionFilesCwdRefreshRetryDelaysMs = [400, 1_000, 2_000] as const
const recoverableCwdRefreshFailureCodes = new Set([
  'CWD_STALE',
  'CWD_TIMEOUT',
])
const proxyConnectionErrorCodePrefix = 'PROXY_'

export type SessionFilesCwdRequestRejection = 'unsupported' | 'not_ready' | 'invalid_path'

export interface SessionFilesViewState {
  path: string
  selectedPaths: string[]
  followTerminal: boolean
  listing: RemoteDirectoryListing | null
  loading: boolean
  error: string
  failedRequestPath: string
  requestSequence: number
  syncStatus: SessionFilesSyncStatus
  syncError: string
  followGeneration: number
  pendingTerminalPath: string
  lastTerminalSyncPath: string
  cwdRefresh: SessionFilesCwdRefreshTransaction
}

export interface SessionFilesNavigationState {
  committedPath: string
  pendingPath: string
  refreshing: boolean
}

export type SessionFilesViewStateMap = Record<string, SessionFilesViewState>

const recoverableCwdRequestErrorCodes = new Set([
  'CWD_BUSY',
  'CWD_NOT_READY',
  'TERMINAL_NOT_READY',
])

export function sessionFilesPendingOperationForFileSession(
  cwdState: SessionCwdState | null,
  currentFileSessionId = '',
) {
  const pending = cwdState?.pending_operation
  if (
    !pending
    || !currentFileSessionId
    || pending.file_session_id === currentFileSessionId
  ) {
    return pending
  }
  return undefined
}

export function resolveSessionFilesCwdRetryTarget(
  cwdState: SessionCwdState | null,
  currentFileSessionId: string,
  requestError: SessionFilesCwdRequestError | null,
  lastTerminalSyncPath: string,
) {
  const pending = sessionFilesPendingOperationForFileSession(
    cwdState,
    currentFileSessionId,
  )
  const targetPath = pending?.status === 'failed'
    ? pending.path
    : requestError
      ? lastTerminalSyncPath
      : ''
  return targetPath ? normalizeRemotePosixPath(targetPath) ?? '' : ''
}

export function deriveSessionFilesSyncState(
  cwdState: SessionCwdState | null,
  requestError: SessionFilesCwdRequestError | null,
  currentFileSessionId = '',
  currentRefreshRequestId = '',
): SessionFilesDerivedSyncState {
  if (cwdState?.control_status === 'reconnect_required') {
    return {
      status: 'reconnect-required',
      error: cwdState.capability_cause ?? '',
    }
  }
  const unsupported = cwdState?.control_status === 'unsupported'
    || (cwdState?.control_status === undefined && cwdState?.capability === 'unsupported')
  if (unsupported) {
    return {
      status: 'unsupported',
      error: cwdState.capability_cause ?? '',
    }
  }
  const proxyErrorCode = sessionFilesCwdProxyErrorCode(
    cwdState,
    requestError,
    currentFileSessionId,
    currentRefreshRequestId,
  )
  if (proxyErrorCode) {
    return {
      status: 'failed',
      error: proxyErrorCode,
    }
  }
  if (!cwdState) {
    return {
      status: 'preparing',
      error: '',
    }
  }
  if (
    cwdState.control_status === 'inactive'
    || cwdState.control_status === 'preparing'
    || cwdState.control_status === 'degraded'
    || (cwdState.control_status === undefined && cwdState.capability === 'probing')
  ) {
    return {
      status: cwdState.shell_phase === 'running' ? 'waiting-idle' : 'preparing',
      error: sessionFilesCwdRefreshErrorMatches(
        cwdState,
        currentRefreshRequestId,
      )
        ? cwdState.refresh_error ?? cwdState.capability_cause ?? ''
        : cwdState.capability_cause ?? '',
    }
  }

  const pending = sessionFilesPendingOperationForFileSession(
    cwdState,
    currentFileSessionId,
  )
  if (pending) {
    return {
      status: pending.status,
      error: pending.error ?? '',
    }
  }
  if (requestError) {
    return {
      status: recoverableCwdRequestErrorCodes.has(requestError.code.toUpperCase())
        ? 'not_ready'
        : 'failed',
      error: requestError.message,
    }
  }
  if (!cwdState.confirmed_path) {
    return { status: 'locating', error: '' }
  }
  return { status: '', error: '' }
}

export function deriveRejectedSessionFilesSyncState(
  rejection: SessionFilesCwdRequestRejection,
  cwdState: SessionCwdState | null,
  reason = '',
): SessionFilesDerivedSyncState {
  if (rejection !== 'not_ready') {
    if (rejection === 'unsupported' && cwdState?.control_status === 'reconnect_required') {
      return {
        status: 'reconnect-required',
        error: reason || cwdState.capability_cause || '',
      }
    }
    return {
      status: rejection,
      error: rejection === 'unsupported'
        ? reason || cwdState?.capability_cause || ''
        : '',
    }
  }
  const current = deriveSessionFilesSyncState(cwdState, null)
  return current.status
    ? current
    : { status: 'not_ready', error: '' }
}

export function deriveSessionFilesCwdRefreshSuccessState(
  cwdState: SessionCwdState | null,
  currentFileSessionId = '',
): SessionFilesDerivedSyncState {
  const pending = sessionFilesPendingOperationForFileSession(
    cwdState,
    currentFileSessionId,
  )
  if (!cwdState || pending?.status !== 'failed') {
    return deriveSessionFilesSyncState(cwdState, null, currentFileSessionId)
  }
  return deriveSessionFilesSyncState({
    ...cwdState,
    pending_operation: undefined,
    desired_path: undefined,
  }, null, currentFileSessionId)
}

export function deriveSessionFilesFollowSyncState(
  cwdState: SessionCwdState | null,
  requestError: SessionFilesCwdRequestError | null,
  refreshError: string,
  refreshPending: boolean,
  refreshConfirmed: boolean,
  transportDisposition: SessionFilesCwdRefreshTransportDisposition,
  currentFileSessionId = '',
  currentRefreshRequestId = '',
): SessionFilesDerivedSyncState {
  const cwdDerived = refreshConfirmed
    ? deriveSessionFilesCwdRefreshSuccessState(cwdState, currentFileSessionId)
    : deriveSessionFilesSyncState(
        cwdState,
        requestError,
        currentFileSessionId,
        currentRefreshRequestId,
      )
  const pending = sessionFilesPendingOperationForFileSession(
    cwdState,
    currentFileSessionId,
  )
  if (refreshConfirmed) {
    return cwdDerived
  }
  if (
    cwdDerived.status === 'unsupported'
    || cwdDerived.status === 'reconnect-required'
    || (
      cwdDerived.status === 'failed'
      && isSessionFilesProxyErrorCode(cwdDerived.error)
    )
    || (pending && pending.status !== 'failed')
  ) {
    return cwdDerived
  }
  if (refreshError) {
    return { status: 'failed', error: refreshError }
  }
  if (refreshPending && transportDisposition === 'failed') {
    return { status: 'failed', error: 'cwd_refresh_transport_unavailable' }
  }
  if (
    cwdState?.control_status === 'inactive'
    || cwdState?.control_status === 'preparing'
    || (cwdState?.control_status === undefined && cwdState?.capability === 'probing')
  ) {
    return cwdDerived
  }
  if (cwdState?.control_status === 'degraded') {
    if (refreshPending) {
      return cwdDerived
    }
    return {
      status: 'failed',
      error: cwdState.control_code
        || (
          sessionFilesCwdRefreshErrorMatches(
            cwdState,
            currentRefreshRequestId,
          )
            ? cwdState.refresh_error_code || cwdState.refresh_error
            : ''
        )
        || cwdState.capability_cause
        || 'CWD_NOT_READY',
    }
  }
  if (refreshPending) {
    if (
      !cwdState
      || transportDisposition === 'wait'
    ) {
      return {
        status: 'preparing',
        error: cwdState?.capability_cause ?? '',
      }
    }
    if (cwdState.shell_phase !== 'prompt') {
      return { status: 'waiting-idle', error: '' }
    }
    if (transportDisposition === 'ready') {
      return { status: 'locating', error: '' }
    }
    return { status: 'preparing', error: '' }
  }
  return cwdDerived
}

export function shouldRefreshFollowedDirectory(
  followTerminal: boolean,
  cwdState: SessionCwdState | null,
  refreshPending: boolean,
) {
  return Boolean(
    followTerminal
    && refreshPending
    && (
      cwdState?.control_status === 'ready'
      || (
        cwdState?.control_status === undefined
        && cwdState?.capability === 'supported'
        && cwdState.shell_phase === 'prompt'
      )
    )
    && (!cwdState.pending_operation || cwdState.pending_operation.status === 'failed'),
  )
}

export function shouldPrepareSessionFilesCwdControl(cwdState: SessionCwdState | null) {
  if (!cwdState) {
    return false
  }
  if (cwdState.control_status !== undefined) {
    return (
      cwdState.control_status === 'inactive'
      || cwdState.control_status === 'preparing'
      || cwdState.control_status === 'degraded'
    )
  }
  return cwdState.capability === 'probing'
}

export function isSessionFilesCwdRefreshComplete(
  cwdState: SessionCwdState | null,
  baseline: SessionFilesCwdRefreshBaseline,
) {
  if (baseline.requestId) {
    if (cwdState?.refresh_request_id !== baseline.requestId) {
      return false
    }
    return cwdState.refresh_status === 'succeeded'
  }
  if ((cwdState?.refresh_seq ?? 0) > baseline.baseRefreshSequence) {
    return true
  }
  const confirmedPath = cwdState?.confirmed_path
    ? normalizeRemotePosixPath(cwdState.confirmed_path)
    : null
  if (!confirmedPath) {
    return false
  }
  const baseConfirmedPath = baseline.baseConfirmedPath
    ? normalizeRemotePosixPath(baseline.baseConfirmedPath)
    : null
  return baseConfirmedPath === null || confirmedPath !== baseConfirmedPath
}

export function hasSessionFilesCwdRefreshRecovered(
  transaction: SessionFilesCwdRefreshTransaction,
  cwdState: SessionCwdState | null,
) {
  if (transaction.phase !== 'failed' || !cwdState) {
    return false
  }
  const confirmedPath = cwdState.confirmed_path
    ? normalizeRemotePosixPath(cwdState.confirmed_path)
    : null
  if (
    transaction.requestId
    && cwdState.refresh_request_id === transaction.requestId
    && cwdState.refresh_status === 'succeeded'
  ) {
    return confirmedPath !== null
  }
  if (
    cwdState.source_generation > transaction.baseSourceGeneration
    || cwdState.refresh_seq > transaction.baseRefreshSequence
  ) {
    return confirmedPath !== null
  }
  const baseConfirmedPath = transaction.baseConfirmedPath
    ? normalizeRemotePosixPath(transaction.baseConfirmedPath)
    : null
  return confirmedPath !== null && confirmedPath !== baseConfirmedPath
}

export function sessionFilesCwdRefreshTransportDisposition(
  state: TerminalTransportState,
): SessionFilesCwdRefreshTransportDisposition {
  if (state === 'live') {
    return 'ready'
  }
  if (state === 'attach_failed' || state === 'ended' || state === 'disposed') {
    return 'failed'
  }
  return 'wait'
}

export function createSessionFilesCwdRefreshWatchdogDeadline(startedAt: number) {
  return startedAt + sessionFilesCwdRefreshWatchdogTimeoutMs
}

export function sessionFilesCwdRefreshWatchdogRemaining(
  deadline: number,
  now: number,
) {
  return Math.max(0, deadline - now)
}

export function sessionFilesCwdRefreshRetryDelay(retryCount: number) {
  return sessionFilesCwdRefreshRetryDelaysMs[retryCount] ?? null
}

export function scheduleSessionFilesCwdRefreshRetry(
  transaction: SessionFilesCwdRefreshTransaction,
  now: number,
) {
  const delay = sessionFilesCwdRefreshRetryDelay(transaction.retryCount)
  if (
    delay === null
    || now >= transaction.deadlineAt
    || now + delay >= transaction.deadlineAt
  ) {
    return null
  }
  return {
    ...transaction,
    phase: 'waiting' as const,
    retryCount: transaction.retryCount + 1,
    retryAt: now + delay,
    error: '',
  }
}

export function reconcileSessionFilesCwdPending(
  transaction: SessionFilesCwdRefreshTransaction,
  cwdState: SessionCwdState | null,
  followTerminal: boolean,
  now: number,
) {
  if (
    !followTerminal
    || now >= transaction.deadlineAt
    || !transaction.requestId
    || cwdState?.refresh_request_id !== transaction.requestId
    || cwdState.refresh_status !== 'pending'
  ) {
    return transaction
  }
  if (cwdState.control_status === 'degraded' && cwdState.control_retryable) {
    if (transaction.retryAt > 0) {
      return transaction
    }
    return scheduleSessionFilesCwdRefreshRetry(transaction, now) ?? transaction
  }
  if (cwdState.control_status === 'ready' && transaction.retryAt > 0) {
    return transaction
  }
  if (transaction.phase === 'pending' && transaction.retryAt === 0) {
    return transaction
  }
  return {
    ...transaction,
    phase: 'pending' as const,
    retryAt: 0,
    error: '',
  }
}

export interface SessionFilesCwdRefreshDispatchBaseline {
  requestId: string
  baseRefreshSequence: number
  baseSourceGeneration: number
  baseConfirmedPath: string
}

export function applySessionFilesCwdRefreshDispatch(
  transaction: SessionFilesCwdRefreshTransaction,
  baseline: SessionFilesCwdRefreshDispatchBaseline,
) {
  return {
    ...transaction,
    phase: 'pending' as const,
    requestId: baseline.requestId,
    baseRefreshSequence: baseline.baseRefreshSequence,
    baseSourceGeneration: baseline.baseSourceGeneration,
    baseConfirmedPath: baseline.baseConfirmedPath,
    retryAt: 0,
    error: '',
  }
}

export function adoptSessionFilesCwdRefreshPending(
  transaction: SessionFilesCwdRefreshTransaction,
  cwdState: SessionCwdState,
) {
  if (!cwdState.refresh_request_id || cwdState.refresh_status !== 'pending') {
    return transaction
  }
  return applySessionFilesCwdRefreshDispatch(transaction, {
    requestId: cwdState.refresh_request_id,
    baseRefreshSequence: cwdState.refresh_seq,
    baseSourceGeneration: cwdState.source_generation,
    baseConfirmedPath: cwdState.confirmed_path ?? '',
  })
}

export function scheduleSessionFilesCwdLocalRetry(
  transaction: SessionFilesCwdRefreshTransaction,
  now: number,
) {
  return {
    ...transaction,
    phase: 'waiting' as const,
    retryAt: Math.min(transaction.deadlineAt, now + sessionFilesCwdLocalRetryDelayMs),
  }
}

export function rebaseSessionFilesCwdRefreshAfterRecoverableFailure(
  transaction: SessionFilesCwdRefreshTransaction,
  cwdState: SessionCwdState | null,
  now: number,
  errorCode = 'CWD_STALE',
) {
  if (
    !recoverableCwdRefreshFailureCodes.has(errorCode.trim().toUpperCase())
    || !transaction.requestId
    || now >= transaction.deadlineAt
    || now + sessionFilesCwdLocalRetryDelayMs >= transaction.deadlineAt
    || transaction.recoveryRetryCount >= sessionFilesCwdRefreshRecoveryRetryLimit
  ) {
    return null
  }
  return {
    ...transaction,
    phase: 'waiting' as const,
    requestId: '',
    baseRefreshSequence: cwdState?.refresh_seq ?? transaction.baseRefreshSequence,
    baseConfirmedPath: cwdState?.confirmed_path ?? '',
    baseSourceGeneration: cwdState?.source_generation ?? transaction.baseSourceGeneration,
    retryCount: 0,
    recoveryRetryCount: transaction.recoveryRetryCount + 1,
    retryAt: now + sessionFilesCwdLocalRetryDelayMs,
    error: '',
  }
}

export function createSessionFilesViewState(initialPath = '/'): SessionFilesViewState {
  return {
    path: normalizeRemotePath(initialPath),
    selectedPaths: [],
    followTerminal: false,
    listing: null,
    loading: false,
    error: '',
    failedRequestPath: '',
    requestSequence: 0,
    syncStatus: '',
    syncError: '',
    followGeneration: 0,
    pendingTerminalPath: '',
    lastTerminalSyncPath: '',
    cwdRefresh: createIdleSessionFilesCwdRefreshTransaction(),
  }
}

export function createIdleSessionFilesCwdRefreshTransaction(
  transactionSequence = 0,
): SessionFilesCwdRefreshTransaction {
  return {
    phase: 'idle',
    transactionSequence,
    requestId: '',
    baseRefreshSequence: 0,
    baseConfirmedPath: '',
    baseSourceGeneration: 0,
    startedAt: 0,
    deadlineAt: 0,
    retryCount: 0,
    recoveryRetryCount: 0,
    retryAt: 0,
    error: '',
  }
}

export function beginSessionFilesCwdRefresh(
  state: SessionFilesViewState,
  cwdState: SessionCwdState | null,
  startedAt: number,
) {
  return {
    ...state,
    followTerminal: true,
    followGeneration: state.followGeneration + 1,
    cwdRefresh: {
      phase: 'waiting' as const,
      transactionSequence: state.cwdRefresh.transactionSequence + 1,
      requestId: '',
      baseRefreshSequence: cwdState?.refresh_seq ?? 0,
      baseConfirmedPath: cwdState?.confirmed_path ?? '',
      baseSourceGeneration: cwdState?.source_generation ?? 0,
      startedAt,
      deadlineAt: createSessionFilesCwdRefreshWatchdogDeadline(startedAt),
      retryCount: 0,
      recoveryRetryCount: 0,
      retryAt: 0,
      error: '',
    },
  }
}

export function finishSessionFilesCwdRefresh(
  state: SessionFilesViewState,
  error = '',
) {
  return {
    ...state,
    cwdRefresh: error
      ? { ...state.cwdRefresh, phase: 'failed' as const, error }
      : createIdleSessionFilesCwdRefreshTransaction(
          state.cwdRefresh.transactionSequence,
        ),
  }
}

export function restartSessionFilesCwdRefresh(
  state: SessionFilesViewState,
  cwdState: SessionCwdState | null,
  startedAt: number,
) {
  if (!state.followTerminal) {
    return state
  }
  return {
    ...beginSessionFilesCwdRefresh(state, cwdState, startedAt),
    lastTerminalSyncPath: '',
    syncStatus: 'preparing' as const,
    syncError: '',
  }
}

export function updateMatchingSessionFilesCwdRefresh(
  state: SessionFilesViewState,
  transaction: SessionFilesCwdRefreshTransaction,
  update: (current: SessionFilesViewState) => SessionFilesViewState,
) {
  if (state.cwdRefresh !== transaction) {
    return state
  }
  return update(state)
}

export type SessionFilesViewStatesAction =
  | {
    type: 'update'
    sessionId: string
    update: Partial<SessionFilesViewState> | ((current: SessionFilesViewState) => SessionFilesViewState)
    initialPath?: string
  }
  | {
    type: 'invalidate-directory-request'
    sessionId: string
    requestSequence: number
    initialPath?: string
  }
  | { type: 'retain'; activeSessionIds: ReadonlySet<string> }

export function sessionFilesViewStatesReducer(
  states: SessionFilesViewStateMap,
  action: SessionFilesViewStatesAction,
) {
  if (action.type === 'retain') {
    return removeInactiveSessionFileStates(states, action.activeSessionIds)
  }
  if (action.type === 'invalidate-directory-request') {
    return updateSessionFilesViewState(
      states,
      action.sessionId,
      (current) => invalidateDirectoryRequest(current, action.requestSequence),
      action.initialPath,
    )
  }
  return updateSessionFilesViewState(
    states,
    action.sessionId,
    action.update,
    action.initialPath,
  )
}

export function invalidateDirectoryRequest(
  state: SessionFilesViewState,
  requestSequence: number,
) {
  if (requestSequence <= state.requestSequence) {
    return state
  }
  return {
    ...state,
    path: state.listing ? normalizeRemotePath(state.listing.path) : state.path,
    loading: false,
    error: '',
    failedRequestPath: '',
    requestSequence,
  }
}

export function getSessionFilesViewState(
  states: SessionFilesViewStateMap,
  sessionId: string,
  initialPath = '/',
) {
  return states[sessionId] ?? createSessionFilesViewState(initialPath)
}

export function updateSessionFilesViewState(
  states: SessionFilesViewStateMap,
  sessionId: string,
  update: Partial<SessionFilesViewState> | ((current: SessionFilesViewState) => SessionFilesViewState),
  initialPath = '/',
): SessionFilesViewStateMap {
  const current = getSessionFilesViewState(states, sessionId, initialPath)
  const next = typeof update === 'function' ? update(current) : { ...current, ...update }
  if (next === current) {
    return states
  }
  return {
    ...states,
    [sessionId]: next,
  }
}

export function beginDirectoryRequest(
  state: SessionFilesViewState,
  targetPath: string,
  requestSequence = state.requestSequence + 1,
) {
  return {
    requestSequence,
    state: {
      ...state,
      path: normalizeRemotePath(targetPath),
      loading: true,
      error: '',
      failedRequestPath: '',
      requestSequence,
    },
  }
}

export function completeDirectoryRequest(
  state: SessionFilesViewState,
  requestSequence: number,
  listing: RemoteDirectoryListing,
) {
  if (requestSequence !== state.requestSequence) {
    return state
  }
  const path = normalizeRemotePath(listing.path)
  const entries = listing.entries ?? []
  const sameDirectory = state.listing
    ? normalizeRemotePath(state.listing.path) === path
    : false
  const entryPaths = new Set(entries.map((entry) => entry.path))
  return {
    ...state,
    path,
    selectedPaths: sameDirectory
      ? state.selectedPaths.filter((selectedPath) => entryPaths.has(selectedPath))
      : [],
    listing: {
      ...listing,
      path,
      parent_path: normalizeRemotePath(listing.parent_path),
      entries,
    },
    loading: false,
    error: '',
    failedRequestPath: '',
    syncStatus: state.followTerminal ? state.syncStatus : '' as const,
    syncError: state.followTerminal ? state.syncError : '',
  }
}

export function failDirectoryRequest(
  state: SessionFilesViewState,
  requestSequence: number,
  message: string,
  failedPath = state.path,
) {
  if (requestSequence !== state.requestSequence) {
    return state
  }
  return {
    ...state,
    path: state.listing ? normalizeRemotePath(state.listing.path) : state.path,
    loading: false,
    error: message,
    failedRequestPath: normalizeRemotePath(failedPath),
  }
}

export function cancelDirectoryRequest(state: SessionFilesViewState) {
  if (!state.loading || !state.listing) {
    return state
  }
  return {
    ...state,
    path: state.listing ? normalizeRemotePath(state.listing.path) : state.path,
    loading: false,
    error: '',
    failedRequestPath: '',
    requestSequence: state.requestSequence + 1,
  }
}

export function cancelDirectoryRequestForFollowRefresh(
  state: SessionFilesViewState,
  invalidatedRequestSequence: number,
) {
  if (!state.loading) {
    return state
  }
  return {
    ...state,
    path: state.listing ? normalizeRemotePath(state.listing.path) : state.path,
    loading: false,
    error: '',
    failedRequestPath: '',
    requestSequence: Math.max(state.requestSequence + 1, invalidatedRequestSequence),
  }
}

export function suspendSessionFilesDirectory(
  state: SessionFilesViewState,
  requestSequence: number,
) {
  const committedPath = state.listing
    ? normalizeRemotePath(state.listing.path)
    : state.path
  const suspended = finishSessionFilesCwdRefresh(state)
  return {
    ...suspended,
    path: committedPath,
    loading: false,
    error: '',
    failedRequestPath: '',
    requestSequence: Math.max(state.requestSequence, requestSequence),
    syncStatus: '' as const,
    syncError: '',
    pendingTerminalPath: '',
    lastTerminalSyncPath: '',
  }
}

export function resolveRecoveredSessionFilesDirectory(
  state: SessionFilesViewState,
  fileSessionPath: string,
  confirmedTerminalPath = '',
) {
  const followedPath = state.followTerminal
    ? normalizeRemotePosixPath(confirmedTerminalPath)
    : null
  return followedPath
    || normalizeRemotePosixPath(state.listing?.path ?? '')
    || normalizeRemotePosixPath(fileSessionPath)
    || '/'
}

export function shouldRequestInitialSessionFilesDirectory(state: SessionFilesViewState) {
  return Boolean(
    !state.followTerminal
    && !state.listing
    && !state.loading
    && !state.error,
  )
}

export function isSessionFilesCwdRefreshPending(
  refresh: SessionFilesCwdRefreshTransaction | undefined,
) {
  return refresh?.phase === 'waiting' || refresh?.phase === 'pending'
}

export function shouldShowSessionFilesInitialLoading(
  state: SessionFilesViewState | null | undefined,
  connected: boolean,
) {
  if (!connected || !state || state.listing || state.error) {
    return false
  }
  return state.loading
    || (
      state.followTerminal
      && isSessionFilesCwdRefreshPending(state.cwdRefresh)
    )
}

export function isSessionFilesProxyErrorCode(errorCode: string | undefined) {
  return errorCode?.trim().toUpperCase().startsWith(proxyConnectionErrorCodePrefix)
    ?? false
}

export function sessionFilesCwdProxyErrorCode(
  cwdState: SessionCwdState | null,
  requestError: SessionFilesCwdRequestError | null = null,
  currentFileSessionId = '',
  currentRefreshRequestId = '',
) {
  const pending = sessionFilesPendingOperationForFileSession(
    cwdState,
    currentFileSessionId,
  )
  const correlatedRefreshErrorCode = sessionFilesCwdRefreshErrorMatches(
    cwdState,
    currentRefreshRequestId,
  )
    ? cwdState?.refresh_error_code
    : undefined
  const candidates = [
    requestError?.code,
    pending?.error_code,
    cwdState?.control_code,
    correlatedRefreshErrorCode,
  ]
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toUpperCase() ?? ''
    if (isSessionFilesProxyErrorCode(normalized)) {
      return normalized
    }
  }
  return ''
}

function sessionFilesCwdRefreshErrorMatches(
  cwdState: SessionCwdState | null,
  currentRefreshRequestId: string,
) {
  return Boolean(
    currentRefreshRequestId
    && cwdState?.refresh_request_id === currentRefreshRequestId
    && (
      cwdState.refresh_status === 'failed'
      || cwdState.refresh_status === 'canceled'
    ),
  )
}

export function shouldRequestFollowedDirectory(
  state: SessionFilesViewState,
  confirmedPath: string,
  pendingPath = '',
) {
  const confirmed = normalizeRemotePath(confirmedPath)
  const current = normalizeRemotePath(state.path)
  const pending = pendingPath ? normalizeRemotePath(pendingPath) : ''
  const listing = state.listing ? normalizeRemotePath(state.listing.path) : ''
  const failed = state.failedRequestPath
    ? normalizeRemotePath(state.failedRequestPath)
    : ''
  const synchronizing = state.syncStatus === 'queued'
    || state.syncStatus === 'waiting-idle'
    || state.syncStatus === 'publishing'
    || state.syncStatus === 'applying'
  const syncBlocked = state.syncStatus === 'failed'
    || state.syncStatus === 'unsupported'
    || state.syncStatus === 'reconnect-required'
    || state.syncStatus === 'not_ready'
    || state.syncStatus === 'invalid_path'

  if (syncBlocked) {
    return false
  }

  if (pending && pending !== confirmed) {
    return false
  }
  if (
    current !== confirmed
    && (synchronizing || (pending && current === pending))
  ) {
    return false
  }
  if (current !== confirmed) {
    return failed !== confirmed
  }
  return !state.loading && listing !== confirmed && failed !== confirmed
}

export function getSessionFilesNavigationState(
  state: SessionFilesViewState,
  confirmedPath = '',
  pendingOperationPath = '',
): SessionFilesNavigationState {
  const committedPath = normalizeRemotePath(state.listing?.path || state.path)
  const requestedPath = normalizeRemotePath(state.path)
  const confirmed = confirmedPath ? normalizeRemotePath(confirmedPath) : ''
  const pendingOperation = pendingOperationPath
    ? normalizeRemotePath(pendingOperationPath)
    : ''
  const failed = state.failedRequestPath
    ? normalizeRemotePath(state.failedRequestPath)
    : ''
  const synchronizing = state.syncStatus === 'queued'
    || state.syncStatus === 'waiting-idle'
    || state.syncStatus === 'publishing'
    || state.syncStatus === 'applying'
  const syncBlocked = state.syncStatus === 'failed'
    || state.syncStatus === 'unsupported'
    || state.syncStatus === 'reconnect-required'
    || state.syncStatus === 'preparing'
    || state.syncStatus === 'locating'
    || state.syncStatus === 'not_ready'
    || state.syncStatus === 'invalid_path'

  let pendingPath = ''
  if (
    state.followTerminal
    && !syncBlocked
    && pendingOperation
    && pendingOperation !== committedPath
    && pendingOperation !== failed
  ) {
    pendingPath = pendingOperation
  } else if (
    state.followTerminal
    && !syncBlocked
    && confirmed
    && confirmed !== committedPath
    && confirmed !== failed
  ) {
    pendingPath = confirmed
  } else if (
    (state.loading || synchronizing)
    && requestedPath !== committedPath
    && requestedPath !== failed
  ) {
    pendingPath = requestedPath
  }

  return {
    committedPath,
    pendingPath,
    refreshing: state.loading && !pendingPath,
  }
}

export function applySessionFilesSyncState(
  state: SessionFilesViewState,
  status: SessionFilesSyncStatus,
  error: string,
  confirmedPath = '',
) {
  const normalizedConfirmedPath = confirmedPath ? normalizeRemotePath(confirmedPath) : ''
  const shouldRollback = status === 'failed'
    && normalizedConfirmedPath
    && state.path !== normalizedConfirmedPath
  if (
    state.syncStatus === status &&
    state.syncError === error &&
    !shouldRollback
  ) {
    return state
  }
  return {
    ...state,
    path: shouldRollback ? normalizedConfirmedPath : state.path,
    syncStatus: status,
    syncError: error,
  }
}

export function removeInactiveSessionFileStates(
  states: SessionFilesViewStateMap,
  activeSessionIds: ReadonlySet<string>,
) {
  const next: SessionFilesViewStateMap = {}
  for (const [sessionId, state] of Object.entries(states)) {
    if (activeSessionIds.has(sessionId)) {
      next[sessionId] = state
    }
  }
  return next
}
