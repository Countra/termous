import type {
  RemoteDirectoryListing,
  SessionCwdState,
} from '../../types/domain.ts'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath.ts'
import { normalizeRemotePath } from '../files/fileUtils.ts'
import type { TerminalTransportState } from '../terminal/terminalTransport.ts'

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
  requestId: string
  baseRefreshSequence: number
  baseConfirmedPath: string
  baseSourceGeneration: number
  startedAt: number
  deadlineAt: number
  retryCount: number
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
const sessionFilesCwdRefreshRetryDelaysMs = [400, 1_000, 2_000] as const

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

export function deriveSessionFilesSyncState(
  cwdState: SessionCwdState | null,
  requestError: SessionFilesCwdRequestError | null,
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
      error: cwdState.refresh_error ?? cwdState.capability_cause ?? '',
    }
  }

  const pending = cwdState.pending_operation
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
): SessionFilesDerivedSyncState {
  if (cwdState?.pending_operation?.status !== 'failed') {
    return deriveSessionFilesSyncState(cwdState, null)
  }
  return deriveSessionFilesSyncState({
    ...cwdState,
    pending_operation: undefined,
    desired_path: undefined,
  }, null)
}

export function deriveSessionFilesFollowSyncState(
  cwdState: SessionCwdState | null,
  requestError: SessionFilesCwdRequestError | null,
  refreshError: string,
  refreshPending: boolean,
  refreshConfirmed: boolean,
  transportDisposition: SessionFilesCwdRefreshTransportDisposition,
): SessionFilesDerivedSyncState {
  const cwdDerived = refreshConfirmed
    ? deriveSessionFilesCwdRefreshSuccessState(cwdState)
    : deriveSessionFilesSyncState(cwdState, requestError)
  if (refreshConfirmed) {
    return cwdDerived
  }
  if (
    cwdDerived.status === 'unsupported'
    || cwdDerived.status === 'reconnect-required'
    || (cwdState?.pending_operation && cwdState.pending_operation.status !== 'failed')
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
    || cwdState?.control_status === 'degraded'
    || (cwdState?.control_status === undefined && cwdState?.capability === 'probing')
  ) {
    return cwdDerived
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
  if (delay === null) {
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
    cwdRefresh: createIdleSessionFilesCwdRefreshTransaction(),
  }
}

export function createIdleSessionFilesCwdRefreshTransaction(): SessionFilesCwdRefreshTransaction {
  return {
    phase: 'idle',
    requestId: '',
    baseRefreshSequence: 0,
    baseConfirmedPath: '',
    baseSourceGeneration: 0,
    startedAt: 0,
    deadlineAt: 0,
    retryCount: 0,
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
      requestId: '',
      baseRefreshSequence: cwdState?.refresh_seq ?? 0,
      baseConfirmedPath: cwdState?.confirmed_path ?? '',
      baseSourceGeneration: cwdState?.source_generation ?? 0,
      startedAt,
      deadlineAt: createSessionFilesCwdRefreshWatchdogDeadline(startedAt),
      retryCount: 0,
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
      : createIdleSessionFilesCwdRefreshTransaction(),
  }
}

export type SessionFilesViewStatesAction =
  | {
    type: 'update'
    sessionId: string
    update: Partial<SessionFilesViewState> | ((current: SessionFilesViewState) => SessionFilesViewState)
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
  return updateSessionFilesViewState(
    states,
    action.sessionId,
    action.update,
    action.initialPath,
  )
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

export function shouldRequestInitialSessionFilesDirectory(state: SessionFilesViewState) {
  return Boolean(
    !state.followTerminal
    && !state.listing
    && !state.loading
    && !state.error,
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
