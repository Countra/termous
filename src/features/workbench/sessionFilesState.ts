import type { RemoteDirectoryListing } from '../../types/domain.ts'
import { normalizeRemotePath } from '../files/fileUtils.ts'

export type SessionFilesSyncStatus =
  | ''
  | 'queued'
  | 'waiting-idle'
  | 'publishing'
  | 'applying'
  | 'failed'
  | 'unsupported'
  | 'not_ready'
  | 'invalid_path'

export interface SessionFilesViewState {
  path: string
  selectedPaths: string[]
  followTerminal: boolean
  scrollTop: number
  listing: RemoteDirectoryListing | null
  loading: boolean
  error: string
  requestSequence: number
  syncStatus: SessionFilesSyncStatus
  syncError: string
}

export type SessionFilesViewStateMap = Record<string, SessionFilesViewState>

export function createSessionFilesViewState(initialPath = '/'): SessionFilesViewState {
  return {
    path: normalizeRemotePath(initialPath),
    selectedPaths: [],
    followTerminal: false,
    scrollTop: 0,
    listing: null,
    loading: false,
    error: '',
    requestSequence: 0,
    syncStatus: '',
    syncError: '',
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
  return {
    ...state,
    path: normalizeRemotePath(listing.path),
    selectedPaths: [],
    listing: {
      ...listing,
      path: normalizeRemotePath(listing.path),
      parent_path: normalizeRemotePath(listing.parent_path),
      entries: listing.entries ?? [],
    },
    loading: false,
    error: '',
    syncStatus: '' as const,
    syncError: '',
  }
}

export function failDirectoryRequest(
  state: SessionFilesViewState,
  requestSequence: number,
  message: string,
) {
  if (requestSequence !== state.requestSequence) {
    return state
  }
  return {
    ...state,
    loading: false,
    error: message,
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
