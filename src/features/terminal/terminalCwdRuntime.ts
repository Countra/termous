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
  | { status: 'queued'; requestId: string; baseRefreshSequence: number }
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
  latestChangeBaseRevision?: number
  latestRefreshBaseSequence?: number
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
      entry.state.capability !== 'supported' ||
      entry.state.shell_phase !== 'prompt' ||
      isCwdOperationInFlight(entry.state.pending_operation) ||
      !entry.transport ||
      !entry.refreshTransport
    ) {
      return { status: 'not_ready' }
    }
    const requestId = createOperationId('cwd-refresh')
    const previousRequestId = entry.latestRequestIds.cwd_refresh
    entry.latestRequestIds.cwd_refresh = requestId
    try {
      if (!entry.refreshTransport(requestId)) {
        entry.latestRequestIds.cwd_refresh = previousRequestId
        return { status: 'not_ready' }
      }
    } catch {
      entry.latestRequestIds.cwd_refresh = previousRequestId
      return { status: 'not_ready' }
    }
    const hadRequestError = entry.requestErrors.cwd_refresh !== null
    entry.requestErrors.cwd_refresh = null
    entry.latestRefreshBaseSequence = entry.state.refresh_seq
    entry.latestRefreshObservedChangeRequestId = entry.latestRequestIds.cwd_change
    if (hadRequestError) {
      this.notify(entry)
    }
    return {
      status: 'queued',
      requestId,
      baseRefreshSequence: entry.state.refresh_seq,
    }
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
    const refreshAdvanced = next.refresh_seq > entry.state.refresh_seq
    const confirmedPathChanged = next.confirmed_path !== entry.state.confirmed_path
    const changeBaseRevision = entry.latestChangeBaseRevision
    entry.state = next
    entry.hasServerState = true
    if (refreshAdvanced) {
      entry.requestErrors.cwd_refresh = null
      entry.latestRequestIds.cwd_refresh = undefined
      entry.latestRefreshBaseSequence = undefined
      if (
        entry.latestRefreshObservedChangeRequestId
        && entry.latestRefreshObservedChangeRequestId === entry.latestRequestIds.cwd_change
      ) {
        entry.requestErrors.cwd_change = null
        entry.latestRequestIds.cwd_change = undefined
        entry.latestChangeBaseRevision = undefined
      }
      entry.latestRefreshObservedChangeRequestId = undefined
    } else {
      if (confirmedPathChanged) {
        entry.requestErrors.cwd_refresh = null
        entry.latestRequestIds.cwd_refresh = undefined
        entry.latestRefreshBaseSequence = undefined
        entry.latestRefreshObservedChangeRequestId = undefined
      }
      if (changeBaseRevision !== undefined && next.revision > changeBaseRevision) {
        entry.requestErrors.cwd_change = null
        if (!next.pending_operation) {
          entry.latestRequestIds.cwd_change = undefined
          entry.latestChangeBaseRevision = undefined
        }
      }
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
    entry.latestChangeBaseRevision = request.base_revision
    entry.requestErrors.cwd_change = null
    entry.latestRequestIds.cwd_refresh = undefined
    entry.latestRefreshBaseSequence = undefined
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
  return !hasServerState || next.state_seq > current.state_seq
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
