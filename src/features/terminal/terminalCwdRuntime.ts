import type {
  SessionCwdChangeRequest,
  SessionCwdOperation,
  SessionCwdState,
} from '../../types/domain'

export const TERMOUS_CWD_PRIVATE_OSC = 6973

export interface TerminalCwdObservation {
  authority: string
  path: string
}

export interface TerminalCwdPrivateObservation {
  kind: 'phase' | 'ack'
  nonce: string
  sourceGeneration: number
  promptGeneration: number
  revision?: number
  operationId?: string
  status?: string
  phase: string
}

export type SessionCwdRequestResult =
  | { status: 'queued'; request: SessionCwdChangeRequest }
  | { status: 'already_current' }
  | { status: 'unsupported'; reason?: string }
  | { status: 'not_ready' }
  | { status: 'invalid_path' }

export type SessionCwdTransport = (request: SessionCwdChangeRequest) => boolean

type SessionListener = () => void

interface SessionCwdEntry {
  state: SessionCwdState
  transport?: SessionCwdTransport
  listeners: Set<SessionListener>
  lastTerminalObservation?: TerminalCwdObservation
  lastPrivateObservation?: TerminalCwdPrivateObservation
}

const initialState: SessionCwdState = {
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

  subscribe = (sessionId: string, listener: SessionListener) => {
    const entry = this.ensureEntry(sessionId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }

  registerTransport(sessionId: string, transport: SessionCwdTransport) {
    const entry = this.ensureEntry(sessionId)
    entry.transport = transport
    return () => {
      const current = this.entries.get(sessionId)
      if (current?.transport === transport) {
        current.transport = undefined
      }
    }
  }

  applyServerState(sessionId: string, candidate: SessionCwdState) {
    const next = normalizeServerState(candidate)
    if (!next) {
      return false
    }
    const entry = this.ensureEntry(sessionId)
    if (!shouldApplyServerState(entry.state, next)) {
      return false
    }
    entry.state = next
    this.notify(entry)
    return true
  }

  applyRequestError(sessionId: string, message: string, operationId?: string) {
    const entry = this.entries.get(sessionId)
    const pending = entry?.state.pending_operation
    if (
      !entry ||
      !pending ||
      (operationId !== undefined && operationId !== pending.id)
    ) {
      return false
    }
    entry.state = {
      ...entry.state,
      desired_path: undefined,
      pending_operation: {
        ...pending,
        status: 'failed',
        error: message,
      },
    }
    this.notify(entry)
    return true
  }

  observeTerminalPath(sessionId: string, observation: TerminalCwdObservation) {
    const path = normalizePosixPath(observation.path)
    const authority = normalizeAuthority(observation.authority)
    if (!path || !authority) {
      return false
    }
    const entry = this.ensureEntry(sessionId)
    entry.lastTerminalObservation = { authority, path }
    return true
  }

  observePrivateControl(sessionId: string, observation: TerminalCwdPrivateObservation) {
    if (!isValidPrivateObservation(observation)) {
      return false
    }
    const entry = this.ensureEntry(sessionId)
    const previous = entry.lastPrivateObservation
    if (
      previous &&
      previous.sourceGeneration === observation.sourceGeneration &&
      previous.promptGeneration > observation.promptGeneration
    ) {
      return false
    }
    entry.lastPrivateObservation = observation
    return true
  }

  requestDirectoryChange(
    sessionId: string,
    fileSessionId: string,
    targetPath: string,
  ): SessionCwdRequestResult {
    const entry = this.ensureEntry(sessionId)
    const path = normalizePosixPath(targetPath)
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

    const revision = Math.max(
      entry.state.revision,
      entry.state.pending_operation?.revision ?? 0,
    ) + 1
    const request: SessionCwdChangeRequest = {
      operation_id: createOperationId(),
      revision,
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

    const pendingOperation: SessionCwdOperation = {
      id: request.operation_id,
      file_session_id: fileSessionId,
      path,
      revision,
      status: 'queued',
    }
    entry.state = {
      ...entry.state,
      desired_path: path,
      revision,
      source: 'files',
      pending_operation: pendingOperation,
    }
    this.notify(entry)
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
    }
    this.entries.set(sessionId, entry)
    return entry
  }

  private notify(entry: SessionCwdEntry) {
    entry.listeners.forEach((listener) => listener())
  }
}

export function parseOSC7Payload(payload: string): TerminalCwdObservation | null {
  try {
    const parsed = new URL(payload)
    if (
      parsed.protocol !== 'file:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    const path = normalizePosixPath(decodeURIComponent(parsed.pathname))
    const authority = normalizeAuthority(parsed.hostname)
    if (!path || !authority) {
      return null
    }
    return { authority, path }
  } catch {
    return null
  }
}

export function parsePrivateCwdPayload(payload: string): TerminalCwdPrivateObservation | null {
  const parts = payload.split(';')
  if (parts.length < 7 || parts[0] !== 'termous' || parts[1] !== '1') {
    return null
  }
  const sourceGeneration = parseSafeInteger(parts[4])
  const promptGeneration = parseSafeInteger(parts[5])
  if (
    !isValidIdentifier(parts[3]) ||
    sourceGeneration === null ||
    promptGeneration === null
  ) {
    return null
  }

  if (parts[2] === 'phase') {
    if (parts.length !== 7 || parts[6] !== 'prompt') {
      return null
    }
    return {
      kind: 'phase',
      nonce: parts[3],
      sourceGeneration,
      promptGeneration,
      phase: parts[6],
    }
  }

  if (parts[2] !== 'cwd' || parts.length !== 10) {
    return null
  }
  const revision = parseSafeInteger(parts[6])
  if (revision === null || !isValidIdentifier(parts[7]) || !parts[8] || !parts[9]) {
    return null
  }
  return {
    kind: 'ack',
    nonce: parts[3],
    sourceGeneration,
    promptGeneration,
    revision,
    operationId: parts[7],
    status: parts[8],
    phase: parts[9],
  }
}

export function normalizePosixPath(value: string) {
  if (
    !value ||
    !value.startsWith('/') ||
    hasControlCharacter(value) ||
    hasUnpairedSurrogate(value)
  ) {
    return null
  }
  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length ? `/${segments.join('/')}` : '/'
}

function normalizeServerState(candidate: SessionCwdState): SessionCwdState | null {
  if (
    !isCwdSource(candidate.source) ||
    !isCwdCapability(candidate.capability) ||
    !isCwdShellPhase(candidate.shell_phase) ||
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
    ? normalizePosixPath(candidate.confirmed_path) ?? undefined
    : undefined
  const desiredPath = candidate.desired_path
    ? normalizePosixPath(candidate.desired_path) ?? undefined
    : undefined
  if (
    (candidate.confirmed_path && !confirmedPath) ||
    (candidate.desired_path && !desiredPath)
  ) {
    return null
  }

  let pendingOperation: SessionCwdOperation | undefined
  if (candidate.pending_operation) {
    const pendingPath = normalizePosixPath(candidate.pending_operation.path)
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

function shouldApplyServerState(current: SessionCwdState, next: SessionCwdState) {
  if (next.source_generation < current.source_generation) {
    return false
  }
  if (next.source_generation > current.source_generation) {
    return true
  }
  if (next.revision < current.revision) {
    return false
  }
  if (
    next.revision === current.revision &&
    next.prompt_generation < current.prompt_generation
  ) {
    return false
  }
  return true
}

function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cwd-${crypto.randomUUID()}`
  }
  return `cwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

function normalizeAuthority(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.length > 255 || hasControlCharacter(normalized)) {
    return null
  }
  return normalized
}

function parseSafeInteger(value: string) {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isValidIdentifier(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isValidPrivateObservation(observation: TerminalCwdPrivateObservation) {
  return (
    isValidIdentifier(observation.nonce) &&
    Number.isSafeInteger(observation.sourceGeneration) &&
    observation.sourceGeneration >= 0 &&
    Number.isSafeInteger(observation.promptGeneration) &&
    observation.promptGeneration >= 0 &&
    (observation.revision === undefined ||
      (Number.isSafeInteger(observation.revision) && observation.revision >= 0))
  )
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) {
        return true
      }
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
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
