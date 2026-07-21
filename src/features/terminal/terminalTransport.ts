import type { SessionCwdChangeRequest } from '../../types/domain'
import {
  decodeTerminalControlMessage,
  decodeTerminalOutputFrame,
  encodeTerminalAttach,
  encodeTerminalCwdChange,
  encodeTerminalCwdRefresh,
  encodeTerminalHeartbeatAck,
  encodeTerminalResize,
  parseTerminalStreamOffset,
  TerminalProtocolError,
  type TerminalOutputGapReason,
  type TerminalRequestScope,
  type TerminalServerControlMessage,
  type TerminalStreamCursor,
  type TerminalStreamSnapshot,
} from './terminalProtocol.ts'

export type TerminalTransportState =
  | 'idle'
  | 'connecting'
  | 'attaching'
  | 'live'
  | 'retry_wait'
  | 'attach_failed'
  | 'ended'
  | 'disposed'

export type TerminalTransportEvent =
  | {
    type: 'transport_state'
    state: TerminalTransportState
    attempt: number
    retryDelayMs?: number
  }
  | {
    type: 'attached'
    message: Extract<TerminalServerControlMessage, { type: 'attached' }>
  }
  | {
    type: 'output'
    data: Uint8Array
  }
  | {
    type: 'output_gap'
    reason: TerminalOutputGapReason
    stream: TerminalStreamSnapshot
  }
  | {
    type: 'session_state'
    message: Extract<TerminalServerControlMessage, { type: 'session_state' }>
  }
  | {
    type: 'cwd_state'
    message: Extract<TerminalServerControlMessage, { type: 'cwd_state' }>
  }
  | {
    type: 'request_error'
    scope: TerminalRequestScope
    code: string
    requestId?: string
    retryable: boolean
    message: string
  }
  | {
    type: 'session_ended'
    message: Extract<TerminalServerControlMessage, { type: 'session_ended' }>
  }
  | {
    type: 'protocol_error'
    error: TerminalProtocolError
  }

export interface TerminalTransportOptions {
  url: string
  onEvent: (event: TerminalTransportEvent) => void
  createSocket?: (url: string) => WebSocket
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  connectTimeoutMs?: number
  attachTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  random?: () => number
}

interface TerminalDimensions {
  cols: number
  rows: number
}

const defaultReconnectBaseDelayMs = 400
const defaultReconnectMaxDelayMs = 15_000
const defaultConnectTimeoutMs = 15_000
const defaultAttachTimeoutMs = 15_000
const defaultHeartbeatIntervalMs = 20_000
const defaultHeartbeatTimeoutMs = 55_000

export class TerminalTransport {
  private readonly url: string
  private readonly onEvent: (event: TerminalTransportEvent) => void
  private readonly createSocket: (url: string) => WebSocket
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly connectTimeoutMs: number
  private readonly attachTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly random: () => number

  private socket: WebSocket | null = null
  private state: TerminalTransportState = 'idle'
  private generation = 0
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  private phaseTimeoutTimer: number | null = null
  private heartbeatTimer: number | null = null
  private lastInboundAt = 0
  private started = false
  private reconnectStopped = false
  private disposed = false
  private cursor: TerminalStreamCursor | undefined
  private pendingResize: TerminalDimensions | undefined
  private outputGap:
    | { reason: TerminalOutputGapReason; stream: TerminalStreamSnapshot }
    | undefined

  constructor(options: TerminalTransportOptions) {
    this.url = options.url
    this.onEvent = options.onEvent
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url))
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs
      ?? defaultReconnectBaseDelayMs
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs
      ?? defaultReconnectMaxDelayMs
    this.connectTimeoutMs = options.connectTimeoutMs ?? defaultConnectTimeoutMs
    this.attachTimeoutMs = options.attachTimeoutMs ?? defaultAttachTimeoutMs
    this.heartbeatIntervalMs = options.heartbeatIntervalMs
      ?? defaultHeartbeatIntervalMs
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs
      ?? defaultHeartbeatTimeoutMs
    this.random = options.random ?? Math.random
  }

  start() {
    if (this.started || this.disposed || this.reconnectStopped) {
      return
    }
    this.started = true
    this.connect()
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.clearReconnectTimer()
    this.clearPhaseTimeout()
    this.stopHeartbeat()
    this.generation += 1
    const socket = this.socket
    this.socket = null
    closeWebSocket(socket)
    this.setState('disposed')
  }

  markSessionEnded() {
    this.stopReconnect('ended')
  }

  isLive() {
    return this.state === 'live' && this.socket?.readyState === WebSocket.OPEN
  }

  sendInput(data: Uint8Array) {
    const socket = this.liveSocket()
    if (!socket || data.byteLength === 0) {
      return false
    }
    try {
      socket.send(data.slice())
      return true
    } catch {
      this.closeCurrentSocket()
      return false
    }
  }

  sendResize(cols: number, rows: number) {
    this.pendingResize = { cols, rows }
    const socket = this.liveSocket()
    if (!socket) {
      return false
    }
    try {
      socket.send(encodeTerminalResize(cols, rows))
      return true
    } catch {
      this.closeCurrentSocket()
      return false
    }
  }

  sendCwdChange(request: SessionCwdChangeRequest) {
    const socket = this.liveSocket()
    if (!socket) {
      return false
    }
    try {
      socket.send(encodeTerminalCwdChange(request))
      return true
    } catch {
      this.closeCurrentSocket()
      return false
    }
  }

  sendCwdRefresh(requestId: string) {
    const socket = this.liveSocket()
    if (!socket) {
      return false
    }
    try {
      socket.send(encodeTerminalCwdRefresh(requestId))
      return true
    } catch {
      this.closeCurrentSocket()
      return false
    }
  }

  private connect() {
    if (this.disposed || this.reconnectStopped || !this.started) {
      return
    }
    this.clearReconnectTimer()
    this.setState('connecting')
    const generation = ++this.generation
    let socket: WebSocket
    try {
      socket = this.createSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => {
      if (!this.isCurrentSocket(socket, generation)) {
        closeWebSocket(socket)
        return
      }
      this.clearPhaseTimeout()
      this.setState('attaching')
      this.lastInboundAt = Date.now()
      try {
        socket.send(encodeTerminalAttach(this.cursor))
        this.startPhaseTimeout(socket, generation, 'attaching', this.attachTimeoutMs)
      } catch {
        this.closeCurrentSocket()
      }
    })
    socket.addEventListener('message', (event) => {
      void this.handleSocketMessage(socket, generation, event.data)
    })
    socket.addEventListener('error', () => {
      if (this.isCurrentSocket(socket, generation)) {
        this.closeCurrentSocket()
      }
    })
    socket.addEventListener('close', () => {
      if (!this.isCurrentSocket(socket, generation)) {
        return
      }
      this.socket = null
      this.clearPhaseTimeout()
      this.stopHeartbeat()
      if (!this.disposed && !this.reconnectStopped) {
        this.scheduleReconnect()
      }
    })
    this.startPhaseTimeout(socket, generation, 'connecting', this.connectTimeoutMs)
  }

  private async handleSocketMessage(
    socket: WebSocket,
    generation: number,
    data: unknown,
  ) {
    if (!this.isCurrentSocket(socket, generation)) {
      return
    }
    this.lastInboundAt = Date.now()
    try {
      if (typeof data === 'string') {
        this.handleControlMessage(decodeTerminalControlMessage(data))
        return
      }
      const payload = data instanceof ArrayBuffer
        ? data
        : data instanceof Blob
          ? await data.arrayBuffer()
          : null
      if (!this.isCurrentSocket(socket, generation)) {
        return
      }
      if (!payload) {
        throw new TerminalProtocolError('Terminal WebSocket payload type is unsupported')
      }
      this.handleOutputFrame(payload)
    } catch (error) {
      if (!this.isCurrentSocket(socket, generation)) {
        return
      }
      const protocolError = error instanceof TerminalProtocolError
        ? error
        : new TerminalProtocolError('Terminal WebSocket message could not be decoded')
      this.onEvent({ type: 'protocol_error', error: protocolError })
      this.closeCurrentSocket()
    }
  }

  private handleControlMessage(message: TerminalServerControlMessage) {
    switch (message.type) {
      case 'attached': {
        const inferredGap = inferOutputGap(message.stream, this.cursor)
        this.applyAttachedStream(message.stream)
        this.reconnectAttempt = 0
        this.clearPhaseTimeout()
        this.setState('live')
        this.startHeartbeat()
        this.onEvent({ type: 'attached', message })
        if (inferredGap) {
          this.recordOutputGap(inferredGap, message.stream)
        }
        this.flushResize()
        return
      }
      case 'output_gap':
        this.cursor = cursorFromStream(message.stream)
        this.recordOutputGap(message.reason, message.stream)
        return
      case 'session_state':
        this.onEvent({ type: 'session_state', message })
        return
      case 'cwd_state':
        this.onEvent({ type: 'cwd_state', message })
        return
      case 'request_error':
        this.onEvent({
          type: 'request_error',
          scope: message.scope,
          code: message.code,
          requestId: message.request_id,
          retryable: message.retryable,
          message: message.message,
        })
        if (message.scope === 'attach') {
          if (message.retryable) {
            this.closeCurrentSocket()
          } else {
            this.stopReconnect('attach_failed')
          }
        }
        return
      case 'session_ended':
        this.onEvent({ type: 'session_ended', message })
        this.markSessionEnded()
        return
      case 'heartbeat':
        this.acknowledgeHeartbeat(message.sent_at)
        return
    }
  }

  private handleOutputFrame(payload: ArrayBuffer) {
    const frame = decodeTerminalOutputFrame(payload)
    const cursor = this.cursor
    if (!cursor) {
      throw new TerminalProtocolError('Terminal output arrived before attachment')
    }
    if (frame.epoch !== cursor.epoch) {
      throw new TerminalProtocolError('Terminal output epoch does not match attachment')
    }

    const frameEnd = frame.startOffset + BigInt(frame.data.byteLength)
    if (frame.startOffset > cursor.nextOffset) {
      throw new TerminalProtocolError('Terminal output contains an unannounced gap')
    }
    if (frameEnd <= cursor.nextOffset) {
      return
    }

    const duplicateBytes = Number(cursor.nextOffset - frame.startOffset)
    const data = duplicateBytes > 0 ? frame.data.slice(duplicateBytes) : frame.data
    this.cursor = {
      epoch: cursor.epoch,
      nextOffset: frameEnd,
    }
    if (data.byteLength > 0) {
      this.onEvent({ type: 'output', data })
    }
  }

  private applyAttachedStream(stream: TerminalStreamSnapshot) {
    this.cursor = cursorFromStream(stream)
  }

  private flushResize() {
    if (this.pendingResize) {
      this.sendResize(this.pendingResize.cols, this.pendingResize.rows)
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.lastInboundAt = Date.now()
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.isLive()) {
        return
      }
      if (Date.now() - this.lastInboundAt >= this.heartbeatTimeoutMs) {
        this.closeCurrentSocket()
      }
    }, this.heartbeatIntervalMs)
  }

  private acknowledgeHeartbeat(sentAt: string) {
    const socket = this.socket
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      (this.state !== 'attaching' && this.state !== 'live')
    ) {
      return
    }
    try {
      socket.send(encodeTerminalHeartbeatAck(sentAt))
    } catch {
      this.closeCurrentSocket()
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private stopReconnect(state: 'attach_failed' | 'ended') {
    if (this.reconnectStopped || this.disposed) {
      return
    }
    this.reconnectStopped = true
    this.clearReconnectTimer()
    this.clearPhaseTimeout()
    this.stopHeartbeat()
    this.generation += 1
    const socket = this.socket
    this.socket = null
    closeWebSocket(socket)
    this.setState(state)
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.disposed || this.reconnectStopped) {
      return
    }
    const exponent = Math.min(this.reconnectAttempt, 8)
    const baseDelay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectBaseDelayMs * (2 ** exponent),
    )
    const jitter = 0.75 + this.random() * 0.5
    const delay = Math.max(0, Math.round(baseDelay * jitter))
    this.reconnectAttempt += 1
    this.setState('retry_wait', delay)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startPhaseTimeout(
    socket: WebSocket,
    generation: number,
    expectedState: 'connecting' | 'attaching',
    timeoutMs: number,
  ) {
    this.clearPhaseTimeout()
    this.phaseTimeoutTimer = window.setTimeout(() => {
      this.phaseTimeoutTimer = null
      if (
        !this.isCurrentSocket(socket, generation) ||
        this.state !== expectedState
      ) {
        return
      }
      this.socket = null
      this.generation += 1
      closeWebSocket(socket)
      this.scheduleReconnect()
    }, Math.max(1, timeoutMs))
  }

  private clearPhaseTimeout() {
    if (this.phaseTimeoutTimer !== null) {
      window.clearTimeout(this.phaseTimeoutTimer)
      this.phaseTimeoutTimer = null
    }
  }

  private recordOutputGap(
    reason: TerminalOutputGapReason,
    stream: TerminalStreamSnapshot,
  ) {
    const previous = this.outputGap
    this.outputGap = { reason, stream }
    if (
      previous?.reason === reason &&
      previous.stream.epoch === stream.epoch &&
      previous.stream.resume_offset === stream.resume_offset
    ) {
      return
    }
    this.onEvent({
      type: 'output_gap',
      reason,
      stream,
    })
  }

  private closeCurrentSocket() {
    const socket = this.socket
    if (!socket) {
      return
    }
    closeWebSocket(socket)
  }

  private liveSocket() {
    if (!this.isLive()) {
      return null
    }
    return this.socket
  }

  private isCurrentSocket(socket: WebSocket, generation: number) {
    return (
      !this.disposed &&
      this.socket === socket &&
      this.generation === generation
    )
  }

  private setState(state: TerminalTransportState, retryDelayMs?: number) {
    if (this.state === state && retryDelayMs === undefined) {
      return
    }
    this.state = state
    this.onEvent({
      type: 'transport_state',
      state,
      attempt: this.reconnectAttempt,
      retryDelayMs,
    })
  }
}

function cursorFromStream(stream: TerminalStreamSnapshot): TerminalStreamCursor {
  return {
    epoch: stream.epoch,
    nextOffset: parseTerminalStreamOffset(stream.resume_offset),
  }
}

function inferOutputGap(
  stream: TerminalStreamSnapshot,
  cursor?: TerminalStreamCursor,
): TerminalOutputGapReason | undefined {
  const oldestOffset = parseTerminalStreamOffset(stream.oldest_offset)
  const resumeOffset = parseTerminalStreamOffset(stream.resume_offset)
  if (!cursor) {
    return oldestOffset > 0n ? 'buffer_evicted' : undefined
  }
  if (cursor.epoch !== stream.epoch) {
    return 'epoch_mismatch'
  }
  if (resumeOffset > cursor.nextOffset) {
    return 'buffer_evicted'
  }
  if (resumeOffset < cursor.nextOffset) {
    return 'offset_ahead'
  }
  return undefined
}

function closeWebSocket(socket: WebSocket | null) {
  if (
    !socket ||
    socket.readyState === WebSocket.CLOSED ||
    socket.readyState === WebSocket.CLOSING
  ) {
    return
  }
  try {
    socket.close()
  } catch {
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener('open', () => closeWebSocket(socket), { once: true })
    }
  }
}
