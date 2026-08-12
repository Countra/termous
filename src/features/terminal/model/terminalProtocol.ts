import type {
  Session,
  SessionCwdChangeRequest,
  SessionCwdState,
} from '#entities/session'

const terminalOutputFrameType = 0x01
const terminalOutputFrameHeaderSize = 25
const maxUint64 = (1n << 64n) - 1n

export type TerminalOutputGapReason =
  | 'epoch_mismatch'
  | 'buffer_evicted'
  | 'offset_ahead'

export type TerminalRequestScope =
  | 'attach'
  | 'resize'
  | 'cwd_change'
  | 'cwd_refresh'
  | 'message'
  | 'terminal_input'

export interface TerminalStreamSnapshot {
  epoch: string
  oldest_offset: string
  next_offset: string
  resume_offset: string
}

export interface TerminalStreamCursor {
  epoch: string
  nextOffset: bigint
}

export interface TerminalPromptBoundary {
  source_generation: number
  shell_id: string
  prompt_generation: number
  shell: string
  cwd: string
  input_epoch: number
  exit_code?: number
}

export interface TerminalInputLock {
  locked: boolean
  owner?: 'command_dispatch'
  task_id?: string
  locked_at?: string
}

export type TerminalServerControlMessage =
  | {
    type: 'attached'
    session: Session
    cwd_state: SessionCwdState
    stream: TerminalStreamSnapshot
    input_lock?: TerminalInputLock
  }
  | {
    type: 'output_gap'
    reason: TerminalOutputGapReason
    stream: TerminalStreamSnapshot
  }
  | {
    type: 'session_state'
    session: Session
  }
  | {
    type: 'cwd_state'
    cwd_state: SessionCwdState
  }
  | ({ type: 'prompt_boundary' } & TerminalPromptBoundary)
  | {
    type: 'input_lock'
    input_lock: TerminalInputLock
  }
  | {
    type: 'request_error'
    scope: TerminalRequestScope
    code: string
    request_id?: string
    retryable: boolean
    message: string
  }
  | {
    type: 'session_ended'
    session: Session
    exit_code?: number
    reason: string
  }
  | {
    type: 'heartbeat'
    sent_at: string
  }

export interface TerminalOutputFrame {
  epoch: string
  startOffset: bigint
  data: Uint8Array
}

export class TerminalProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalProtocolError'
  }
}

export function encodeTerminalAttach(cursor?: TerminalStreamCursor) {
  return JSON.stringify({
    type: 'attach',
    ...(cursor
      ? {
        stream_epoch: cursor.epoch,
        last_offset: cursor.nextOffset.toString(),
      }
      : {}),
  })
}

export function encodeTerminalResize(cols: number, rows: number) {
  if (!isPositiveSafeInteger(cols) || !isPositiveSafeInteger(rows)) {
    throw new TerminalProtocolError('Invalid terminal dimensions')
  }
  return JSON.stringify({ type: 'resize', cols, rows })
}

export function encodeTerminalCwdChange(request: SessionCwdChangeRequest) {
  return JSON.stringify({ type: 'cwd_change', cwd_change: request })
}

export function encodeTerminalCwdRefresh(requestId: string) {
  return JSON.stringify({ type: 'cwd_refresh', request_id: requestId })
}

export function encodeTerminalHeartbeatAck(sentAt: string) {
  return JSON.stringify({ type: 'heartbeat_ack', sent_at: sentAt })
}

export function decodeTerminalControlMessage(payload: string): TerminalServerControlMessage {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new TerminalProtocolError('Terminal control message is not valid JSON')
  }
  const message = requireRecord(value, 'Terminal control message must be an object')
  const type = requireString(message.type, 'Terminal control message type is missing')

  switch (type) {
    case 'attached':
      return {
        type,
        session: decodeSession(message.session),
        cwd_state: decodeCwdState(message.cwd_state),
        stream: decodeStreamSnapshot(message.stream),
        input_lock: decodeOptionalInputLock(message.input_lock ?? message.input_state),
      }
    case 'output_gap':
      return {
        type,
        reason: decodeGapReason(message.reason),
        stream: decodeStreamSnapshot(message.stream),
      }
    case 'session_state':
      return {
        type,
        session: decodeSession(message.session),
      }
    case 'cwd_state':
      return {
        type,
        cwd_state: decodeCwdState(message.cwd_state),
      }
    case 'prompt_boundary':
      return {
        type,
        ...decodePromptBoundary(message),
      }
    case 'input_lock':
    case 'input_state':
      return {
        type: 'input_lock',
        input_lock: decodeInputLock(message.input_lock ?? message.input_state),
      }
    case 'request_error':
      return {
        type,
        scope: decodeRequestScope(message.scope),
        code: requireString(message.code, 'Terminal request error code is missing'),
        request_id: optionalString(message.request_id),
        retryable: requireBoolean(
          message.retryable,
          'Terminal request retryable flag is missing',
        ),
        message: requireString(message.message, 'Terminal request error message is missing'),
      }
    case 'session_ended':
      return {
        type,
        session: decodeSession(message.session),
        exit_code: optionalSafeInteger(message.exit_code),
        reason: requireString(message.reason, 'Terminal session end reason is missing'),
      }
    case 'heartbeat':
      return {
        type,
        sent_at: requireString(message.sent_at, 'Terminal heartbeat timestamp is missing'),
      }
    default:
      throw new TerminalProtocolError(`Unsupported terminal control message: ${type}`)
  }
}

export function decodeTerminalOutputFrame(
  payload: ArrayBuffer | Uint8Array,
): TerminalOutputFrame {
  const bytes = payload instanceof Uint8Array
    ? payload
    : new Uint8Array(payload)
  if (bytes.byteLength < terminalOutputFrameHeaderSize) {
    throw new TerminalProtocolError('Terminal output frame is truncated')
  }
  if (bytes[0] !== terminalOutputFrameType) {
    throw new TerminalProtocolError('Terminal output frame type is unsupported')
  }

  const epochBytes = bytes.subarray(1, 17)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const startOffset = view.getBigUint64(17, false)
  const data = bytes.slice(terminalOutputFrameHeaderSize)
  if (startOffset > maxUint64 - BigInt(data.byteLength)) {
    throw new TerminalProtocolError('Terminal output frame exceeds uint64 offset range')
  }
  return {
    epoch: bytesToHex(epochBytes),
    startOffset,
    data,
  }
}

export function parseTerminalStreamOffset(value: string): bigint {
  if (value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new TerminalProtocolError('Terminal stream offset is invalid')
  }
  const offset = BigInt(value)
  if (offset > maxUint64) {
    throw new TerminalProtocolError('Terminal stream offset exceeds uint64')
  }
  return offset
}

function decodeStreamSnapshot(value: unknown): TerminalStreamSnapshot {
  const stream = requireRecord(value, 'Terminal stream snapshot is missing')
  const epoch = requireString(stream.epoch, 'Terminal stream epoch is missing').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(epoch)) {
    throw new TerminalProtocolError('Terminal stream epoch is invalid')
  }

  const oldestOffset = requireString(
    stream.oldest_offset,
    'Terminal oldest offset is missing',
  )
  const nextOffset = requireString(stream.next_offset, 'Terminal next offset is missing')
  const resumeOffset = requireString(
    stream.resume_offset,
    'Terminal resume offset is missing',
  )
  const oldest = parseTerminalStreamOffset(oldestOffset)
  const next = parseTerminalStreamOffset(nextOffset)
  const resume = parseTerminalStreamOffset(resumeOffset)
  if (oldest > resume || resume > next) {
    throw new TerminalProtocolError('Terminal stream offsets are inconsistent')
  }
  return {
    epoch,
    oldest_offset: oldest.toString(),
    next_offset: next.toString(),
    resume_offset: resume.toString(),
  }
}

function decodeSession(value: unknown): Session {
  const session = requireRecord(value, 'Terminal session snapshot is missing')
  requireString(session.id, 'Terminal session id is missing')
  requireString(session.status, 'Terminal session status is missing')
  return session as unknown as Session
}

function decodeCwdState(value: unknown): SessionCwdState {
  const state = requireRecord(value, 'Terminal CWD state is missing')
  if (!Number.isSafeInteger(state.state_seq) || Number(state.state_seq) < 0) {
    throw new TerminalProtocolError('Terminal CWD state sequence is invalid')
  }
  const refreshSequence = state.refresh_seq ?? 0
  if (!Number.isSafeInteger(refreshSequence) || Number(refreshSequence) < 0) {
    throw new TerminalProtocolError('Terminal CWD refresh sequence is invalid')
  }
  return {
    ...state,
    refresh_seq: Number(refreshSequence),
  } as unknown as SessionCwdState
}

function decodePromptBoundary(message: Record<string, unknown>): TerminalPromptBoundary {
  const exitCode = optionalSafeInteger(message.exit_code)
  return {
    source_generation: requireNonNegativeSafeInteger(
      message.source_generation,
      'Terminal prompt source generation is invalid',
    ),
    shell_id: requireString(message.shell_id, 'Terminal prompt shell id is missing'),
    prompt_generation: requireNonNegativeSafeInteger(
      message.prompt_generation,
      'Terminal prompt generation is invalid',
    ),
    shell: requireString(message.shell, 'Terminal prompt shell is missing'),
    cwd: requireString(message.cwd, 'Terminal prompt directory is missing'),
    input_epoch: requireNonNegativeSafeInteger(
      message.input_epoch,
      'Terminal prompt input epoch is invalid',
    ),
    ...(exitCode === undefined ? {} : { exit_code: exitCode }),
  }
}

function decodeOptionalInputLock(value: unknown) {
  return value === undefined ? undefined : decodeInputLock(value)
}

function decodeInputLock(value: unknown): TerminalInputLock {
  const state = requireRecord(value, 'Terminal input lock is missing')
  const ownerValue = state.owner ?? (state.owner_id ? 'command_dispatch' : undefined)
  if (ownerValue !== undefined && ownerValue !== 'command_dispatch') {
    throw new TerminalProtocolError('Terminal input lock owner is invalid')
  }
  return {
    locked: requireBoolean(state.locked, 'Terminal input lock state is missing'),
    owner: ownerValue,
    task_id: optionalString(state.task_id ?? state.owner_id),
    locked_at: optionalString(state.locked_at),
  }
}

function decodeGapReason(value: unknown): TerminalOutputGapReason {
  if (
    value === 'epoch_mismatch' ||
    value === 'buffer_evicted' ||
    value === 'offset_ahead'
  ) {
    return value
  }
  throw new TerminalProtocolError('Terminal output gap reason is invalid')
}

function decodeRequestScope(value: unknown): TerminalRequestScope {
  if (
    value === 'attach' ||
    value === 'resize' ||
    value === 'cwd_change' ||
    value === 'cwd_refresh' ||
    value === 'message' ||
    value === 'terminal_input'
  ) {
    return value
  }
  throw new TerminalProtocolError('Terminal request scope is invalid')
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TerminalProtocolError(message)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, message: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TerminalProtocolError(message)
  }
  return value
}

function optionalString(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  return requireString(value, 'Terminal control string is invalid')
}

function requireBoolean(value: unknown, message: string) {
  if (typeof value !== 'boolean') {
    throw new TerminalProtocolError(message)
  }
  return value
}

function requireNonNegativeSafeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TerminalProtocolError(message)
  }
  return Number(value)
}

function optionalSafeInteger(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isSafeInteger(value)) {
    throw new TerminalProtocolError('Terminal exit code is invalid')
  }
  return Number(value)
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function bytesToHex(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, '0')
  }
  return value
}
