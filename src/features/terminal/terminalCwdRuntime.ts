import type {
  SessionCwdChangeRequest,
  SessionCwdOperation,
  SessionCwdState,
} from '../../types/domain'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath.ts'
import type { TerminalTransportState } from './terminalTransport.ts'

export type SessionCwdRequestResult =
  | { status: 'queued'; request: SessionCwdChangeRequest }
  | { status: 'already_current' }
  | { status: 'unsupported'; reason?: string }
  | { status: 'not_ready' }
  | { status: 'invalid_path' }

export type SessionCwdRefreshResult =
  | {
    status: 'queued'
    requestId: string
    baseRefreshSequence: number
    baseSourceGeneration: number
    baseConfirmedPath: string
  }
  | { status: 'not_ready' }

export type SessionCwdRequestScope = 'cwd_change' | 'cwd_refresh'

export type SessionCwdTransport = (request: SessionCwdChangeRequest) => boolean
export type SessionCwdRefreshTransport = (requestId: string) => boolean

export interface SessionCwdRequestError {
  scope: SessionCwdRequestScope
  request_id: string
  code: string
  retryable: boolean
  message: string
}

type SessionListener = () => void

interface SessionCwdEntry {
  state: SessionCwdState
  transport?: SessionCwdTransport
  refreshTransport?: SessionCwdRefreshTransport
  listeners: Set<SessionListener>
  latestRequestIds: Partial<Record<SessionCwdRequestScope, string>>
  latestChangeRequest?: SessionCwdChangeRequest
  latestChangeBaseRevision?: number
  latestRefreshBaseSequence?: number
  latestRefreshBaseSourceGeneration?: number
  latestRefreshBaseConfirmedPath?: string
  latestRefreshObservedChangeRequestId?: string
  requestErrors: Record<SessionCwdRequestScope, SessionCwdRequestError | null>
  transportState: TerminalTransportState
  hasServerState: boolean
}

const initialState: SessionCwdState = {
  state_seq: 0,
  refresh_seq: 0,
  revision: 0,
  source: 'none',
  capability: 'probing',
  shell_phase: 'unknown',
  prompt_generation: 0,
  source_generation: 0,
}

export class TerminalCwdRuntime {
  private readonly entries = new Map<string, SessionCwdEntry>()

  getSnapshot = (sessionId: string): SessionCwdState => {
    return this.entries.get(sessionId)?.state ?? initialState
  }

  getRequestErrorSnapshot = (
    sessionId: string,
    scope: SessionCwdRequestScope = 'cwd_change',
  ) => {
    return this.entries.get(sessionId)?.requestErrors[scope] ?? null
  }

  getTransportStateSnapshot = (sessionId: string): TerminalTransportState => {
    return this.entries.get(sessionId)?.transportState ?? 'idle'
  }

  subscribe = (sessionId: string, listener: SessionListener) => {
    const entry = this.ensureEntry(sessionId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }

  registerTransport(
    sessionId: string,
    transport: SessionCwdTransport,
    refreshTransport?: SessionCwdRefreshTransport,
  ) {
    const entry = this.ensureEntry(sessionId)
    entry.transport = transport
    entry.refreshTransport = refreshTransport
    return () => {
      const current = this.entries.get(sessionId)
      if (current?.transport === transport) {
        current.transport = undefined
        current.refreshTransport = undefined
      }
    }
  }

  applyTransportState(sessionId: string, state: TerminalTransportState) {
    const entry = this.ensureEntry(sessionId)
    if (entry.transportState === state) {
      return false
    }
    entry.transportState = state
    this.notify(entry)
    return true
  }

  refreshDirectory(sessionId: string): SessionCwdRefreshResult {
    const entry = this.entries.get(sessionId)
    if (
      !entry ||
      !canRequestCwdRefresh(entry.state) ||
      isCwdOperationInFlight(entry.state.pending_operation) ||
      !entry.transport ||
      !entry.refreshTransport
    ) {
      return { status: 'not_ready' }
    }
    const activeRequestId = entry.latestRequestIds.cwd_refresh
    if (activeRequestId) {
      return {
        status: 'queued',
        requestId: activeRequestId,
        baseRefreshSequence: entry.latestRefreshBaseSequence ?? entry.state.refresh_seq,
        baseSourceGeneration:
          entry.latestRefreshBaseSourceGeneration ?? entry.state.source_generation,
        baseConfirmedPath:
          entry.latestRefreshBaseConfirmedPath ?? entry.state.confirmed_path ?? '',
      }
    }
    const requestId = createOperationId('cwd-refresh')
    const previousRequestId = entry.latestRequestIds.cwd_refresh
    const previousBaseRefreshSequence = entry.latestRefreshBaseSequence
    const previousBaseSourceGeneration = entry.latestRefreshBaseSourceGeneration
    const previousBaseConfirmedPath = entry.latestRefreshBaseConfirmedPath
    const baseRefreshSequence = entry.state.refresh_seq
    const baseSourceGeneration = entry.state.source_generation
    const baseConfirmedPath = entry.state.confirmed_path ?? ''
    entry.latestRequestIds.cwd_refresh = requestId
    entry.latestRefreshBaseSequence = baseRefreshSequence
    entry.latestRefreshBaseSourceGeneration = baseSourceGeneration
    entry.latestRefreshBaseConfirmedPath = baseConfirmedPath
    try {
      if (!entry.refreshTransport(requestId)) {
        entry.latestRequestIds.cwd_refresh = previousRequestId
        entry.latestRefreshBaseSequence = previousBaseRefreshSequence
        entry.latestRefreshBaseSourceGeneration = previousBaseSourceGeneration
        entry.latestRefreshBaseConfirmedPath = previousBaseConfirmedPath
        return { status: 'not_ready' }
      }
    } catch {
      entry.latestRequestIds.cwd_refresh = previousRequestId
      entry.latestRefreshBaseSequence = previousBaseRefreshSequence
      entry.latestRefreshBaseSourceGeneration = previousBaseSourceGeneration
      entry.latestRefreshBaseConfirmedPath = previousBaseConfirmedPath
      return { status: 'not_ready' }
    }
    const hadRequestError = entry.requestErrors.cwd_refresh !== null
    entry.requestErrors.cwd_refresh = null
    entry.latestRefreshObservedChangeRequestId = entry.latestRequestIds.cwd_change
    if (hadRequestError) {
      this.notify(entry)
    }
    return {
      status: 'queued',
      requestId,
      baseRefreshSequence,
      baseSourceGeneration,
      baseConfirmedPath,
    }
  }

  retryRefreshDirectory(sessionId: string, requestId: string): SessionCwdRefreshResult {
    const entry = this.entries.get(sessionId)
    if (
      !entry
      || entry.latestRequestIds.cwd_refresh !== requestId
      || !canRequestCwdRefresh(entry.state)
      || isCwdOperationInFlight(entry.state.pending_operation)
      || !entry.transport
      || !entry.refreshTransport
    ) {
      return { status: 'not_ready' }
    }
    try {
      if (!entry.refreshTransport(requestId)) {
        return { status: 'not_ready' }
      }
    } catch {
      return { status: 'not_ready' }
    }
    const hadRequestError = entry.requestErrors.cwd_refresh !== null
    entry.requestErrors.cwd_refresh = null
    if (hadRequestError) {
      this.notify(entry)
    }
    return {
      status: 'queued',
      requestId,
      baseRefreshSequence: entry.latestRefreshBaseSequence ?? entry.state.refresh_seq,
      baseSourceGeneration:
        entry.latestRefreshBaseSourceGeneration ?? entry.state.source_generation,
      baseConfirmedPath:
        entry.latestRefreshBaseConfirmedPath ?? entry.state.confirmed_path ?? '',
    }
  }

  clearRequestError(
    sessionId: string,
    scope: SessionCwdRequestScope,
    requestId: string,
  ) {
    const entry = this.entries.get(sessionId)
    if (entry?.requestErrors[scope]?.request_id !== requestId) {
      return false
    }
    entry.requestErrors[scope] = null
    this.notify(entry)
    return true
  }

  applyServerState(sessionId: string, candidate: SessionCwdState) {
    const next = normalizeServerState(candidate)
    if (!next) {
      return false
    }
    const entry = this.ensureEntry(sessionId)
    if (!shouldApplyServerState(entry.state, next, entry.hasServerState)) {
      return false
    }
    const previousState = entry.state
    const sourceChanged = next.source_generation > previousState.source_generation
    const refreshAdvanced = sourceChanged || next.refresh_seq > previousState.refresh_seq
    const confirmedPathChanged = next.confirmed_path !== entry.state.confirmed_path
    const changeBaseRevision = entry.latestChangeBaseRevision
    const failedChangeCorrelated = Boolean(
      entry.latestChangeRequest
      && next.pending_operation?.status === 'failed'
      && next.pending_operation.id === entry.latestChangeRequest.operation_id
    )
    entry.state = next
    entry.hasServerState = true
    if (sourceChanged) {
      entry.requestErrors.cwd_change = null
      entry.latestRequestIds.cwd_change = undefined
      entry.latestChangeRequest = undefined
      entry.latestChangeBaseRevision = undefined
      entry.requestErrors.cwd_refresh = null
      entry.latestRequestIds.cwd_refresh = undefined
      entry.latestRefreshBaseSequence = undefined
      entry.latestRefreshBaseSourceGeneration = undefined
      entry.latestRefreshBaseConfirmedPath = undefined
      entry.latestRefreshObservedChangeRequestId = undefined
    }
    const refreshRequestId = entry.latestRequestIds.cwd_refresh
    const refreshCorrelated = Boolean(
      refreshRequestId
      && next.refresh_request_id === refreshRequestId,
    )
    const refreshTerminal = refreshCorrelated
      && next.refresh_status !== undefined
      && next.refresh_status !== 'pending'
    const legacyRefreshComplete = !next.refresh_request_id
      && (refreshAdvanced || confirmedPathChanged)
    if (refreshTerminal || legacyRefreshComplete) {
      entry.requestErrors.cwd_refresh = null
      entry.latestRequestIds.cwd_refresh = undefined
      entry.latestRefreshBaseSequence = undefined
      entry.latestRefreshBaseSourceGeneration = undefined
      entry.latestRefreshBaseConfirmedPath = undefined
      if (
        entry.latestRefreshObservedChangeRequestId
        && entry.latestRefreshObservedChangeRequestId === entry.latestRequestIds.cwd_change
      ) {
        entry.requestErrors.cwd_change = null
        entry.latestRequestIds.cwd_change = undefined
        entry.latestChangeRequest = undefined
        entry.latestChangeBaseRevision = undefined
      }
      entry.latestRefreshObservedChangeRequestId = undefined
    } else {
      if (changeBaseRevision !== undefined && next.revision > changeBaseRevision) {
        entry.requestErrors.cwd_change = null
        if (!next.pending_operation) {
          entry.latestRequestIds.cwd_change = undefined
          entry.latestChangeRequest = undefined
          entry.latestChangeBaseRevision = undefined
        }
      }
    }
    if (failedChangeCorrelated) {
      entry.requestErrors.cwd_change = null
      entry.latestRequestIds.cwd_change = undefined
      entry.latestChangeRequest = undefined
      entry.latestChangeBaseRevision = undefined
    }
    this.notify(entry)
    return true
  }

  applyRequestError(sessionId: string, error: SessionCwdRequestError) {
    const entry = this.entries.get(sessionId)
    if (
      !entry ||
      !entry.latestRequestIds[error.scope] ||
      error.request_id !== entry.latestRequestIds[error.scope]
    ) {
      return false
    }
    entry.requestErrors[error.scope] = error
    if (error.scope === 'cwd_change') {
      entry.latestChangeRequest = undefined
    } else if (!error.retryable) {
      entry.latestRequestIds.cwd_refresh = undefined
      entry.latestRefreshBaseSequence = undefined
      entry.latestRefreshBaseSourceGeneration = undefined
      entry.latestRefreshBaseConfirmedPath = undefined
    }
    this.notify(entry)
    return true
  }

  requestDirectoryChange(
    sessionId: string,
    fileSessionId: string,
    targetPath: string,
  ): SessionCwdRequestResult {
    const entry = this.ensureEntry(sessionId)
    const path = normalizeRemotePosixPath(targetPath)
    if (!path || !isValidIdentifier(fileSessionId)) {
      return { status: 'invalid_path' }
    }
    if (entry.state.capability === 'unsupported') {
      return {
        status: 'unsupported',
        reason: entry.state.capability_cause,
      }
    }
    if (entry.state.capability !== 'supported' || !entry.transport) {
      return { status: 'not_ready' }
    }
    if (entry.state.confirmed_path === path && !entry.state.pending_operation) {
      return { status: 'already_current' }
    }
    if (
      entry.latestChangeRequest?.path === path
      && entry.latestChangeRequest.file_session_id === fileSessionId
    ) {
      return { status: 'queued', request: entry.latestChangeRequest }
    }

    const request: SessionCwdChangeRequest = {
      operation_id: createOperationId(),
      base_revision: entry.state.revision,
      file_session_id: fileSessionId,
      path,
    }
    let accepted: boolean
    try {
      accepted = entry.transport(request)
    } catch {
      return { status: 'not_ready' }
    }
    if (!accepted) {
      return { status: 'not_ready' }
    }

    const hadRequestError = entry.requestErrors.cwd_change !== null
      || entry.requestErrors.cwd_refresh !== null
    entry.latestRequestIds.cwd_change = request.operation_id
    entry.latestChangeRequest = request
    entry.latestChangeBaseRevision = request.base_revision
    entry.requestErrors.cwd_change = null
    entry.latestRequestIds.cwd_refresh = undefined
    entry.latestRefreshBaseSequence = undefined
    entry.latestRefreshBaseSourceGeneration = undefined
    entry.latestRefreshBaseConfirmedPath = undefined
    entry.requestErrors.cwd_refresh = null
    if (hadRequestError) {
      this.notify(entry)
    }
    return { status: 'queued', request }
  }

  retainSessions(sessionIds: ReadonlySet<string>) {
    for (const sessionId of this.entries.keys()) {
      if (!sessionIds.has(sessionId)) {
        this.removeSession(sessionId)
      }
    }
  }

  removeSession(sessionId: string) {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    const listeners = [...entry.listeners]
    this.entries.delete(sessionId)
    listeners.forEach((listener) => listener())
    entry.listeners.clear()
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.listeners.clear()
    }
    this.entries.clear()
  }

  private ensureEntry(sessionId: string) {
    const existing = this.entries.get(sessionId)
    if (existing) {
      return existing
    }
    const entry: SessionCwdEntry = {
      state: { ...initialState },
      listeners: new Set(),
      latestRequestIds: {},
      requestErrors: {
        cwd_change: null,
        cwd_refresh: null,
      },
      transportState: 'idle',
      hasServerState: false,
    }
    this.entries.set(sessionId, entry)
    return entry
  }

  private notify(entry: SessionCwdEntry) {
    entry.listeners.forEach((listener) => listener())
  }
}

function normalizeServerState(candidate: SessionCwdState): SessionCwdState | null {
  if (
    !isCwdSource(candidate.source) ||
    !isCwdCapability(candidate.capability) ||
    !isCwdShellPhase(candidate.shell_phase) ||
    (candidate.observation_status !== undefined
      && !isCwdObservationStatus(candidate.observation_status)) ||
    (candidate.control_status !== undefined
      && !isCwdControlStatus(candidate.control_status)) ||
    (candidate.refresh_status !== undefined
      && !isCwdRefreshStatus(candidate.refresh_status)) ||
    (candidate.control_retryable !== undefined
      && typeof candidate.control_retryable !== 'boolean') ||
    !Number.isSafeInteger(candidate.state_seq) ||
    candidate.state_seq < 0 ||
    !Number.isSafeInteger(candidate.refresh_seq) ||
    candidate.refresh_seq < 0 ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0 ||
    !Number.isSafeInteger(candidate.prompt_generation) ||
    candidate.prompt_generation < 0 ||
    !Number.isSafeInteger(candidate.source_generation) ||
    candidate.source_generation < 0
  ) {
    return null
  }
  const confirmedPath = candidate.confirmed_path
    ? normalizeRemotePosixPath(candidate.confirmed_path) ?? undefined
    : undefined
  const desiredPath = candidate.desired_path
    ? normalizeRemotePosixPath(candidate.desired_path) ?? undefined
    : undefined
  if (
    (candidate.confirmed_path && !confirmedPath) ||
    (candidate.desired_path && !desiredPath)
  ) {
    return null
  }

  let pendingOperation: SessionCwdOperation | undefined
  if (candidate.pending_operation) {
    const pendingPath = normalizeRemotePosixPath(candidate.pending_operation.path)
    if (
      !pendingPath ||
      !isValidIdentifier(candidate.pending_operation.id) ||
      !isValidIdentifier(candidate.pending_operation.file_session_id) ||
      !Number.isSafeInteger(candidate.pending_operation.revision) ||
      candidate.pending_operation.revision <= 0 ||
      candidate.pending_operation.revision !== candidate.revision ||
      !isCwdOperationStatus(candidate.pending_operation.status)
    ) {
      return null
    }
    pendingOperation = {
      ...candidate.pending_operation,
      path: pendingPath,
    }
  }

  return {
    ...candidate,
    confirmed_path: confirmedPath,
    desired_path: desiredPath,
    pending_operation: pendingOperation,
  }
}

function shouldApplyServerState(
  current: SessionCwdState,
  next: SessionCwdState,
  hasServerState: boolean,
) {
  if (!hasServerState) {
    return true
  }
  if (next.source_generation !== current.source_generation) {
    return next.source_generation > current.source_generation
  }
  return next.state_seq > current.state_seq
}

function createOperationId(prefix = 'cwd') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

function isValidIdentifier(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isCwdSource(value: string) {
  return value === 'none' || value === 'terminal' || value === 'files'
}

function isCwdCapability(value: string) {
  return value === 'probing' || value === 'supported' || value === 'unsupported'
}

function isCwdShellPhase(value: string) {
  return (
    value === 'unknown' ||
    value === 'prompt' ||
    value === 'running' ||
    value === 'alternate-screen'
  )
}

function isCwdObservationStatus(value: string) {
  return value === 'probing' || value === 'ready' || value === 'unavailable'
}

function isCwdControlStatus(value: string) {
  return (
    value === 'inactive' ||
    value === 'preparing' ||
    value === 'ready' ||
    value === 'degraded' ||
    value === 'reconnect_required' ||
    value === 'unsupported'
  )
}

function isCwdRefreshStatus(value: string) {
  return (
    value === 'pending' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

function isCwdOperationStatus(value: string) {
  return (
    value === 'queued' ||
    value === 'waiting-idle' ||
    value === 'publishing' ||
    value === 'applying' ||
    value === 'failed'
  )
}

function isCwdOperationInFlight(operation: SessionCwdOperation | undefined) {
  return Boolean(operation && operation.status !== 'failed')
}

function canRequestCwdRefresh(state: SessionCwdState) {
  if (state.control_status !== undefined) {
    return (
      state.control_status === 'inactive' ||
      state.control_status === 'preparing' ||
      state.control_status === 'ready' ||
      state.control_status === 'degraded'
    )
  }
  return state.capability === 'supported' && state.shell_phase === 'prompt'
}
