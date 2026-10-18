import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { NotificationEvent } from '#common/contracts'
import { NotificationStream } from './index.ts'

class Socket {
  static instances: Socket[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor() { Socket.instances.push(this) }
  close() { this.closed = true }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

const snapshot = { type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } }

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = globalThis.WebSocket
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
  Socket.instances = []
  const events: NotificationEvent[] = []
  let failures = 0
  const stream = new NotificationStream({ url: () => 'ws://127.0.0.1/fixture', receive: (event) => events.push(event), disconnected: () => { failures++ } })
  t.after(() => { stream.close(); globalThis.WebSocket = original })
  return { stream, events, failures: () => failures }
}

test('没有首帧时主动释放并重连，不依赖浏览器返回 close', async (t) => {
  const f = fixture(t)
  await f.stream.start()
  t.mock.timers.tick(10_000)
  assert.equal(Socket.instances[0].closed, true)
  assert.equal(f.failures(), 1)
  t.mock.timers.tick(1000)
  assert.equal(Socket.instances.length, 2)
  Socket.instances[1].emit(snapshot)
  t.mock.timers.tick(60_000)
  assert.equal(Socket.instances.length, 2)
  assert.equal(f.events.length, 1)
})

test('首帧必须是快照；无效帧和重复错误只安排一次重连', async (t) => {
  const f = fixture(t)
  await f.stream.start()
  const first = Socket.instances[0]
  const lateError = first.onerror
  first.emit({ type: 'unexpected' })
  lateError?.()
  assert.equal(f.failures(), 1)
  t.mock.timers.tick(1000)
  assert.equal(Socket.instances.length, 2)
  assert.equal(f.events.length, 0)
})

test('合法增量也不能代替初始权威快照', async (t) => {
  const f = fixture(t)
  await f.stream.start()
  Socket.instances[0].emit({ type: 'upsert', message: {
    id: 'one', sequence: 1, source_id: 'task', kind: 'file', outcome: 'success',
    occurred_at: new Date().toISOString(), operation: 'upload_file', completed_files: 1,
    total_files: 1, skipped_items: 0, native_eligible: true, read: false,
  } })
  assert.equal(f.failures(), 1)
  assert.equal(f.events.length, 0)
})

test('连接错误立即重试调度，重新启动后忽略旧回调', async (t) => {
  const f = fixture(t)
  await f.stream.start()
  const first = Socket.instances[0]
  const oldMessage = first.onmessage
  first.onerror?.()
  assert.equal(first.closed, true)
  f.stream.close()
  await f.stream.start()
  oldMessage?.({ data: JSON.stringify(snapshot) })
  assert.equal(f.events.length, 0)
  Socket.instances[1].emit(snapshot)
  t.mock.timers.tick(60_000)
  assert.equal(Socket.instances.length, 2)
  assert.equal(f.events.length, 1)
})

test('重复 start 不会遗留连接，关闭后取消首帧期限和重连', async (t) => {
  const f = fixture(t)
  await f.stream.start()
  await f.stream.start()
  assert.equal(Socket.instances.length, 1)
  f.stream.close()
  t.mock.timers.tick(60_000)
  assert.equal(f.failures(), 0)
  assert.equal(Socket.instances.length, 1)
})

test('地址异步返回前关闭并重新启动，旧地址及错误不能影响新连接', async (t) => {
  fixture(t)
  let reject!: (reason: Error) => void
  let requests = 0
  let failures = 0
  const stream = new NotificationStream({
    url: () => ++requests === 1 ? new Promise<string>((_resolve, fail) => { reject = fail }) : 'ws://127.0.0.1/current',
    receive() {}, disconnected() { failures++ },
  })
  t.after(() => stream.close())
  const first = stream.start()
  stream.close()
  await stream.start()
  reject(new Error('stale configuration'))
  await first
  assert.equal(failures, 0)
  assert.equal(Socket.instances.length, 1)
  assert.equal(Socket.instances[0].closed, false)
})
