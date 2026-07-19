import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TerminalTransport,
  type TerminalTransportEvent,
} from '../features/terminal/terminalTransport.ts'

const epoch = '000102030405060708090a0b0c0d0e0f'

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  readonly sent: Array<string | ArrayBufferView> = []
  closeCalls = 0

  send(data: string | ArrayBufferView) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('socket is not open')
    }
    this.sent.push(data)
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return
    }
    this.closeCalls += 1
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(data: unknown) {
    const event = new Event('message') as Event & { data: unknown }
    event.data = data
    this.dispatchEvent(event)
  }
}

test('transport 保留流游标、去重输出、确认心跳并独立重连', () => {
  const originalWebSocket = globalThis.WebSocket
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })

  const socket = new FakeWebSocket()
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => socket as unknown as WebSocket,
    reconnectBaseDelayMs: 10_000,
    reconnectMaxDelayMs: 10_000,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
    random: () => 0.5,
  })

  try {
    transport.start()
    socket.open()
    assert.deepEqual(JSON.parse(String(socket.sent[0])), { type: 'attach' })

    socket.receive(JSON.stringify({
      type: 'attached',
      session: { id: 'session-1', status: 'connected' },
      cwd_state: { state_seq: 1 },
      stream: {
        epoch,
        oldest_offset: '0',
        next_offset: '0',
        resume_offset: '0',
      },
    }))
    assert.equal(transport.isLive(), true)

    socket.receive(outputFrame(0n, [0x61, 0x62, 0x63]))
    socket.receive(outputFrame(1n, [0x62, 0x63, 0x64, 0x65]))
    const output = events
      .filter((event): event is Extract<TerminalTransportEvent, { type: 'output' }> => (
        event.type === 'output'
      ))
      .flatMap((event) => [...event.data])
    assert.deepEqual(output, [0x61, 0x62, 0x63, 0x64, 0x65])

    socket.receive(JSON.stringify({
      type: 'heartbeat',
      sent_at: '2026-07-19T10:00:00Z',
    }))
    assert.deepEqual(JSON.parse(String(socket.sent[socket.sent.length - 1])), {
      type: 'heartbeat_ack',
      sent_at: '2026-07-19T10:00:00Z',
    })

    socket.close()
    assert.equal(
      events.some((event) => (
        event.type === 'transport_state' && event.state === 'retry_wait'
      )),
      true,
    )
    assert.equal(
      events.some((event) => event.type === 'session_ended'),
      false,
    )
  } finally {
    transport.dispose()
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  }
})

test('旧 generation 的 Blob 解码完成后不会误报或关闭新连接', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
    random: () => 0.5,
  })

  let resolveBlob: (payload: ArrayBuffer) => void = () => undefined
  const blobPayload = new Promise<ArrayBuffer>((resolve) => {
    resolveBlob = resolve
  })
  const deferredBlob = new Blob()
  Object.defineProperty(deferredBlob, 'arrayBuffer', {
    value: () => blobPayload,
  })

  try {
    transport.start()
    const first = sockets[0]
    first.open()
    first.receive(attachedMessage('connected'))
    first.receive(deferredBlob)
    first.close()

    await nextTimer()
    const second = sockets[1]
    assert.ok(second)
    second.open()
    second.receive(attachedMessage('connected'))
    assert.equal(transport.isLive(), true)

    resolveBlob(outputFrame(0n, [0x61]))
    await nextTimer()

    assert.equal(
      events.some((event) => event.type === 'protocol_error'),
      false,
    )
    assert.equal(second.readyState, FakeWebSocket.OPEN)
    assert.equal(second.closeCalls, 0)
    assert.equal(transport.isLive(), true)
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('不可重试的 attach 拒绝会停止重连而不伪造 session_ended', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    random: () => 0.5,
  })

  try {
    transport.start()
    sockets[0].open()
    sockets[0].receive(JSON.stringify({
      type: 'request_error',
      scope: 'attach',
      code: 'SESSION_NOT_FOUND',
      retryable: false,
      message: '会话不存在',
    }))
    await nextTimer()

    assert.equal(sockets.length, 1)
    assert.equal(sockets[0].readyState, FakeWebSocket.CLOSED)
    assert.equal(
      events.some((event) => (
        event.type === 'transport_state' && event.state === 'attach_failed'
      )),
      true,
    )
    assert.equal(
      events.some((event) => event.type === 'session_ended'),
      false,
    )
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('retryable attach 拒绝进入退避并创建新 generation', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    random: () => 0.5,
  })

  try {
    transport.start()
    sockets[0].open()
    sockets[0].receive(JSON.stringify({
      type: 'request_error',
      scope: 'attach',
      code: 'ATTACH_BUSY',
      retryable: true,
      message: '稍后重试',
    }))
    assert.equal(
      events.some((event) => (
        event.type === 'transport_state' && event.state === 'retry_wait'
      )),
      true,
    )

    await nextTimer()
    assert.equal(sockets.length, 2)
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('终态 attached 会先完整 replay，再以 session_ended 停止 transport', () => {
  const restoreBrowser = installFakeBrowser()
  const socket = new FakeWebSocket()
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => socket as unknown as WebSocket,
  })

  try {
    transport.start()
    socket.open()
    socket.receive(attachedMessage('disconnected'))
    assert.equal(transport.isLive(), true)

    socket.receive(outputFrame(0n, [0x61, 0x62, 0x63]))
    socket.receive(JSON.stringify({
      type: 'session_ended',
      session: { id: 'session-1', status: 'disconnected' },
      exit_code: 0,
      reason: '会话已结束',
    }))

    const attachedIndex = events.findIndex((event) => event.type === 'attached')
    const outputIndex = events.findIndex((event) => event.type === 'output')
    const endedIndex = events.findIndex((event) => event.type === 'session_ended')
    const endedStateIndex = events.findIndex((event) => (
      event.type === 'transport_state' && event.state === 'ended'
    ))
    assert.ok(attachedIndex >= 0)
    assert.ok(outputIndex > attachedIndex)
    assert.ok(endedIndex > outputIndex)
    assert.ok(endedStateIndex > endedIndex)
    assert.equal(socket.readyState, FakeWebSocket.CLOSED)
    assert.equal(transport.isLive(), false)
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('connecting 与 attaching 超时都会进入独立重连', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: () => undefined,
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    connectTimeoutMs: 5,
    attachTimeoutMs: 5,
    random: () => 0.5,
  })

  try {
    transport.start()
    await waitFor(() => sockets.length >= 2)
    assert.equal(sockets[0].closeCalls, 1)

    sockets[1].open()
    await waitFor(() => sockets.length >= 3)
    assert.equal(sockets[1].closeCalls, 1)
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('attached 已原子暴露回放缺口，后续断线不会吞掉提示', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    connectTimeoutMs: 1_000,
    attachTimeoutMs: 1_000,
    random: () => 0.5,
  })

  try {
    transport.start()
    sockets[0].open()
    sockets[0].receive(attachedMessage('connected'))
    sockets[0].receive(outputFrame(0n, [0x61, 0x62, 0x63]))
    sockets[0].close()
    await waitFor(() => sockets.length >= 2)

    sockets[1].open()
    sockets[1].receive(attachedMessageAt('10', '10', '10'))
    const gaps = events.filter((event) => event.type === 'output_gap')
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]?.type === 'output_gap' ? gaps[0].reason : '', 'buffer_evicted')

    sockets[1].close()
    await waitFor(() => sockets.length >= 3)
    sockets[2].open()
    assert.deepEqual(JSON.parse(String(sockets[2].sent[0])), {
      type: 'attach',
      stream_epoch: epoch,
      last_offset: '10',
    })
    sockets[2].receive(attachedMessageAt('10', '10', '10'))
    assert.equal(events.filter((event) => event.type === 'output_gap').length, 1)
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

test('offset_ahead 后重连使用 attached 的权威回放游标', async () => {
  const restoreBrowser = installFakeBrowser()
  const sockets: FakeWebSocket[] = []
  const events: TerminalTransportEvent[] = []
  const transport = new TerminalTransport({
    url: 'ws://termous.test/terminal',
    onEvent: (event) => events.push(event),
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    reconnectBaseDelayMs: 0,
    reconnectMaxDelayMs: 0,
    connectTimeoutMs: 1_000,
    attachTimeoutMs: 1_000,
    random: () => 0.5,
  })

  try {
    transport.start()
    sockets[0].open()
    sockets[0].receive(attachedMessage('connected'))
    sockets[0].receive(outputFrame(0n, [0x61, 0x62, 0x63]))
    sockets[0].close()
    await waitFor(() => sockets.length >= 2)

    sockets[1].open()
    sockets[1].receive(attachedMessageAt('0', '3', '1'))
    const gaps = events.filter((event) => event.type === 'output_gap')
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]?.type === 'output_gap' ? gaps[0].reason : '', 'offset_ahead')

    sockets[1].close()
    await waitFor(() => sockets.length >= 3)
    sockets[2].open()
    assert.deepEqual(JSON.parse(String(sockets[2].sent[0])), {
      type: 'attach',
      stream_epoch: epoch,
      last_offset: '1',
    })
  } finally {
    transport.dispose()
    restoreBrowser()
  }
})

function attachedMessage(status: 'connected' | 'disconnected') {
  return attachedMessageAt('0', '0', '0', status)
}

function attachedMessageAt(
  oldestOffset: string,
  nextOffset: string,
  resumeOffset: string,
  status: 'connected' | 'disconnected' = 'connected',
) {
  return JSON.stringify({
    type: 'attached',
    session: { id: 'session-1', status },
    cwd_state: { state_seq: 1 },
    stream: {
      epoch,
      oldest_offset: oldestOffset,
      next_offset: nextOffset,
      resume_offset: resumeOffset,
    },
  })
}

function installFakeBrowser() {
  const originalWebSocket = globalThis.WebSocket
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
  return () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  }
}

function nextTimer() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail('timed out waiting for transport state')
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2)
    })
  }
}

function outputFrame(startOffset: bigint, payload: number[]) {
  const frame = new Uint8Array(25 + payload.length)
  frame[0] = 0x01
  for (let index = 0; index < 16; index += 1) {
    frame[index + 1] = index
  }
  new DataView(frame.buffer).setBigUint64(17, startOffset, false)
  frame.set(payload, 25)
  return frame.buffer
}
