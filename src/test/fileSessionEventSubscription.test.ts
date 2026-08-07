import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fileSessionEventReconnectDelay,
  subscribeFileSessionEvents,
} from '../widgets/files-workspace/model/fileSessionEventSubscription.ts'

class FakeWebSocket extends EventTarget {
  readyState = 0
  closeCalls = 0

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  close() {
    if (this.readyState === 3) {
      return
    }
    this.closeCalls += 1
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  disconnect() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

function fakeScheduler() {
  let nextId = 1
  const pending = new Map<number, () => void>()
  const delays: number[] = []
  return {
    delays,
    get size() {
      return pending.size
    },
    schedule(callback: () => void, delayMs: number) {
      const id = nextId
      nextId += 1
      pending.set(id, callback)
      delays.push(delayMs)
      return id
    },
    cancel(id: number) {
      pending.delete(id)
    },
    runNext() {
      const entry = pending.entries().next().value as [number, () => void] | undefined
      assert.ok(entry)
      pending.delete(entry[0])
      entry[1]()
    },
  }
}

test('文件会话事件流意外断开后先对账快照再重订阅', async () => {
  const scheduler = fakeScheduler()
  const sockets: FakeWebSocket[] = []
  const snapshots: string[] = []
  let snapshotRequests = 0
  const subscription = subscribeFileSessionEvents({
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    getSnapshot: async () => {
      snapshotRequests += 1
      return 'snapshot-1'
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onMessage: () => true,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  sockets[0].open()
  sockets[0].disconnect()
  assert.deepEqual(scheduler.delays, [400])
  assert.equal(sockets.length, 1)

  scheduler.runNext()
  await Promise.resolve()
  assert.equal(snapshotRequests, 1)
  assert.deepEqual(snapshots, ['snapshot-1'])
  assert.equal(sockets.length, 2)

  subscription.dispose()
})

test('主动退役握手中的事件流不会重订阅', () => {
  const scheduler = fakeScheduler()
  const socket = new FakeWebSocket()
  let snapshotRequests = 0
  const subscription = subscribeFileSessionEvents({
    createSocket: () => socket as unknown as WebSocket,
    getSnapshot: async () => {
      snapshotRequests += 1
      return 'snapshot-1'
    },
    onSnapshot: () => undefined,
    onMessage: () => true,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  subscription.dispose()
  socket.open()

  assert.equal(socket.closeCalls, 1)
  assert.equal(snapshotRequests, 0)
  assert.equal(scheduler.size, 0)
})

test('旧代际快照返回前退役时不应用快照或重订阅', async () => {
  const scheduler = fakeScheduler()
  const sockets: FakeWebSocket[] = []
  const snapshots: string[] = []
  let resolveSnapshot: ((snapshot: string) => void) | undefined
  const snapshotPromise = new Promise<string>((resolve) => {
    resolveSnapshot = resolve
  })
  const subscription = subscribeFileSessionEvents({
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    getSnapshot: () => snapshotPromise,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onMessage: () => true,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  sockets[0].open()
  sockets[0].disconnect()
  scheduler.runNext()
  subscription.dispose()
  resolveSnapshot?.('stale-snapshot')
  await Promise.resolve()

  assert.deepEqual(snapshots, [])
  assert.equal(sockets.length, 1)
  assert.equal(scheduler.size, 0)
})

test('文件会话事件流重订阅退避存在明确上限', () => {
  assert.equal(fileSessionEventReconnectDelay(0), 400)
  assert.equal(fileSessionEventReconnectDelay(4), 5_000)
  assert.equal(fileSessionEventReconnectDelay(100), 5_000)
})

test('连续建立后立即断开会递增退避，合法消息才会重置', async () => {
  const scheduler = fakeScheduler()
  const sockets: FakeWebSocket[] = []
  const subscription = subscribeFileSessionEvents({
    createSocket: () => {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    getSnapshot: async () => 'snapshot',
    onSnapshot: () => undefined,
    onMessage: () => true,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  sockets[0].disconnect()
  scheduler.runNext()
  await Promise.resolve()
  sockets[1].open()
  sockets[1].disconnect()
  assert.deepEqual(scheduler.delays, [400, 800])

  scheduler.runNext()
  await Promise.resolve()
  sockets[2].open()
  sockets[2].receive('valid')
  sockets[2].disconnect()
  assert.deepEqual(scheduler.delays, [400, 800, 400])

  subscription.dispose()
})

test('快照确认会话不存在后终止重订阅', async () => {
  const scheduler = fakeScheduler()
  const socket = new FakeWebSocket()
  let missing = false
  const subscription = subscribeFileSessionEvents({
    createSocket: () => socket as unknown as WebSocket,
    getSnapshot: async () => {
      throw { code: 'SFTP_FILE_SESSION_NOT_FOUND' }
    },
    onSnapshot: () => undefined,
    onMessage: () => true,
    onSnapshotError: (error) => {
      missing = Boolean(error && typeof error === 'object' && 'code' in error)
      return 'stop'
    },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  socket.disconnect()
  scheduler.runNext()
  await Promise.resolve()

  assert.equal(missing, true)
  assert.equal(scheduler.size, 0)
  subscription.dispose()
})

test('收到明确终止消息后不再请求旧会话快照', () => {
  const scheduler = fakeScheduler()
  const socket = new FakeWebSocket()
  let snapshotRequests = 0
  const subscription = subscribeFileSessionEvents({
    createSocket: () => socket as unknown as WebSocket,
    getSnapshot: async () => {
      snapshotRequests += 1
      return 'snapshot'
    },
    onSnapshot: () => undefined,
    onMessage: () => 'stop',
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  socket.open()
  socket.receive('closed')

  assert.equal(socket.closeCalls, 1)
  assert.equal(snapshotRequests, 0)
  assert.equal(scheduler.size, 0)
  subscription.dispose()
})

test('快照回调异常被转换为可控的恢复策略', async () => {
  const scheduler = fakeScheduler()
  const socket = new FakeWebSocket()
  let handledErrors = 0
  const subscription = subscribeFileSessionEvents({
    createSocket: () => socket as unknown as WebSocket,
    getSnapshot: async () => 'snapshot',
    onSnapshot: () => {
      throw new Error('apply failed')
    },
    onMessage: () => true,
    onSnapshotError: () => {
      handledErrors += 1
      return 'stop'
    },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  socket.disconnect()
  scheduler.runNext()
  await Promise.resolve()

  assert.equal(handledErrors, 1)
  assert.equal(scheduler.size, 0)
  subscription.dispose()
})
