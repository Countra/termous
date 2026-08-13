import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CommandDispatchOutputStream,
  CommandDispatchTarget,
  CommandDispatchTask,
} from '#entities/command-dispatch'
import type { CommandDispatchGateway } from '../api/commandDispatchGateway.ts'
import { decodeTerminalOutputFrame } from '../../terminal/model/terminalProtocol.ts'
import { CommandDispatchOutputStore } from './commandDispatchOutputStore.ts'

const epoch = '000102030405060708090a0b0c0d0e0f'

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly sockets: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  binaryType: BinaryType = 'blob'
  readonly url: string

  constructor(url: string) {
    super()
    this.url = url
    FakeWebSocket.sockets.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  receive(data: unknown) {
    const event = new Event('message') as Event & { data: unknown }
    event.data = data
    this.dispatchEvent(event)
  }
}

test('输出 Store 重放 canonical gap/ended 并隔离旧连接异步 Blob', async () => {
  const restoreBrowser = installFakeBrowser()
  const store = new CommandDispatchOutputStore(gateway(), decodeTerminalOutputFrame)
  FakeWebSocket.sockets.length = 0
  let resolveDeferredBlob: (data: ArrayBuffer) => void = () => undefined
  const deferredData = new Promise<ArrayBuffer>((resolve) => {
    resolveDeferredBlob = resolve
  })
  const deferredBlob = new Blob()
  Object.defineProperty(deferredBlob, 'arrayBuffer', { value: () => deferredData })

  try {
    store.retainTask(taskFixture())
    assert.equal(FakeWebSocket.sockets.length, 0)
    const unsubscribe = store.subscribe('task-1', 'session-1', () => undefined)
    const first = FakeWebSocket.sockets[0]
    assert.ok(first)
    first.open()
    first.receive(JSON.stringify(attachedFixture(false)))
    first.receive(deferredBlob)
    first.close()

    await nextTimer()
    const second = FakeWebSocket.sockets[1]
    assert.ok(second)
    second.open()
    second.receive(JSON.stringify(attachedFixture(true, 'buffer_evicted')))

    resolveDeferredBlob(outputFrame(0n, [0x78]))
    await nextTimer()
    const afterStaleBlob = store.getSnapshot('task-1', 'session-1')
    assert.equal(afterStaleBlob.data.byteLength, 0)
    assert.equal(second.readyState, FakeWebSocket.OPEN)
    assert.equal(afterStaleBlob.gapReason, 'buffer_evicted')
    assert.equal(afterStaleBlob.truncated, true)
    assert.equal(afterStaleBlob.ended, false)

    second.receive(outputFrame(0n, [0x61, 0x62, 0x63]))
    assert.deepEqual(
      [...store.getSnapshot('task-1', 'session-1').data],
      [0x61, 0x62, 0x63],
    )
    second.close()
    await nextTimer()
    const third = FakeWebSocket.sockets[2]
    assert.ok(third)
    third.open()
    third.receive(JSON.stringify(attachedFixture(true)))
    third.receive(JSON.stringify(endedFixture(3)))
    assert.equal(store.getSnapshot('task-1', 'session-1').ended, true)
    third.close()
    await nextTimer()
    assert.equal(FakeWebSocket.sockets.length, 3)
    unsubscribe()
  } finally {
    store.dispose()
    restoreBrowser()
  }
})

test('未展示的目标不建立输出连接，取消最后一个订阅后停止重连', async () => {
  const restoreBrowser = installFakeBrowser()
  const store = new CommandDispatchOutputStore(gateway(), decodeTerminalOutputFrame)
  FakeWebSocket.sockets.length = 0
  try {
    store.retainTask(taskFixture())
    assert.equal(FakeWebSocket.sockets.length, 0)

    const unsubscribe = store.subscribe('task-1', 'session-1', () => undefined)
    assert.equal(FakeWebSocket.sockets.length, 1)
    FakeWebSocket.sockets[0]?.open()
    unsubscribe()
    await nextTimer()

    assert.equal(FakeWebSocket.sockets[0]?.readyState, FakeWebSocket.CLOSED)
    assert.equal(FakeWebSocket.sockets.length, 1)
  } finally {
    store.dispose()
    restoreBrowser()
  }
})

test('畸形末帧使旧连接失效并从原游标重放，忽略旧连接随后到达的结束帧', async () => {
  const restoreBrowser = installFakeBrowser()
  const store = new CommandDispatchOutputStore(gateway(), decodeTerminalOutputFrame)
  FakeWebSocket.sockets.length = 0
  try {
    store.retainTask(taskFixture())
    const unsubscribe = store.subscribe('task-1', 'session-1', () => undefined)
    const first = FakeWebSocket.sockets[0]
    assert.ok(first)
    first.open()
    first.receive(JSON.stringify(attachedFixture(false)))
    first.receive(outputFrame(0n, [0x61]))
    first.receive(new ArrayBuffer(2))

    const invalid = store.getSnapshot('task-1', 'session-1')
    assert.equal(invalid.gapReason, 'protocol_error')
    assert.equal(invalid.truncated, true)
    assert.equal(invalid.ended, false)
    assert.equal(first.readyState, FakeWebSocket.CLOSED)

    first.receive(JSON.stringify(endedFixture(1)))
    assert.equal(store.getSnapshot('task-1', 'session-1').ended, false)

    await nextTimer()
    const second = FakeWebSocket.sockets[1]
    assert.ok(second)
    assert.match(second.url, /offset=1/)
    second.open()
    second.receive(JSON.stringify({
      ...attachedFixture(true),
      stream: {
        ...streamFixture(true),
        next_offset: '1',
        resume_offset: '1',
      },
    }))
    second.receive(outputFrame(1n, [0x62]))
    second.receive(JSON.stringify(endedFixture(2)))

    const recovered = store.getSnapshot('task-1', 'session-1')
    assert.deepEqual([...recovered.data], [0x61, 0x62])
    assert.equal(recovered.ended, true)
    unsubscribe()
  } finally {
    store.dispose()
    restoreBrowser()
  }
})

test('不存在的输出快照在同一 Store 内保持稳定且可随任务切换清理', () => {
  const store = new CommandDispatchOutputStore(gateway(), decodeTerminalOutputFrame)
  const first = store.getSnapshot('missing-task', 'missing-session')
  assert.equal(store.getSnapshot('missing-task', 'missing-session'), first)
  store.retainTask(taskFixture())
  store.retainTask(null)
  assert.notEqual(store.getSnapshot('missing-task', 'missing-session'), first)
  store.dispose()
})

function gateway(): CommandDispatchGateway {
  const unsupported = () => Promise.reject(new Error('本测试不调用 HTTP'))
  return {
    createTask: unsupported,
    latestTask: unsupported,
    task: unsupported,
    interruptTask: unsupported,
    interruptTarget: unsupported,
    taskEventsUrl: (taskId) => `ws://termous.test/tasks/${taskId}`,
    targetOutputUrl: (taskId, sessionId, cursor) => (
      `ws://termous.test/tasks/${taskId}/${sessionId}?offset=${cursor?.lastOffset ?? ''}`
    ),
  }
}

function taskFixture(): CommandDispatchTask {
  return {
    id: 'task-1',
    client_request_id: 'request-1',
    revision: 1,
    scope: 'current',
    command: 'printf test',
    status: 'running',
    target_session_ids: ['session-1'],
    targets: [targetFixture()],
    total_targets: 1,
    completed_targets: 0,
    succeeded_targets: 0,
    failed_targets: 0,
    interrupted_targets: 0,
    rejected_targets: 0,
    unknown_targets: 0,
    interruptible: true,
    created_at: '2026-08-12T00:00:00Z',
  }
}

function targetFixture(): CommandDispatchTarget {
  return {
    session_id: 'session-1',
    index: 0,
    status: 'running',
    exit_code_known: false,
    input_lock: {
      locked: true,
      owner: 'command_dispatch',
      task_id: 'task-1',
    },
    output_stream: streamFixture(false),
  }
}

function attachedFixture(
  ended: boolean,
  reason?: 'buffer_evicted',
) {
  return {
    type: 'output_attached',
    task_id: 'task-1',
    session_id: 'session-1',
    target: targetFixture(),
    stream: streamFixture(Boolean(reason)),
    reason,
    ended,
  }
}

function endedFixture(nextOffset: number) {
  return {
    type: 'output_ended',
    target: targetFixture(),
    stream: {
      ...streamFixture(false),
      next_offset: String(nextOffset),
      resume_offset: String(nextOffset),
    },
  }
}

function streamFixture(truncated: boolean): CommandDispatchOutputStream {
  return {
    epoch,
    oldest_offset: '0',
    next_offset: '0',
    resume_offset: '0',
    truncated,
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

function installFakeBrowser() {
  const originalWebSocket = globalThis.WebSocket
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (handler: () => void) => setTimeout(handler, 0),
      clearTimeout: (timer: number) => clearTimeout(timer),
    },
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
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
