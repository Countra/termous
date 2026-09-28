import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NotificationEvent } from '#common/contracts'
import { NotificationSubscription } from './subscription.ts'

class Socket {
  static instances: Socket[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor() { Socket.instances.push(this) }
  close() { this.closed = true; this.onclose?.() }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

test('原生订阅断线重连并获取新 Core 配置，关闭后不再接收或重连', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = globalThis.WebSocket
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
  t.after(() => { globalThis.WebSocket = original })
  Socket.instances = []
  let configs = 0
  const events: NotificationEvent[] = []
  const subscription = new NotificationSubscription({ config: async () => { configs++; return { apiBaseUrl: 'http://127.0.0.1:8152', apiToken: 'fixture', version: 'test' } }, receive: (event) => events.push(event), warn() {} })
  const snapshot = { type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } }
  await subscription.start()
  Socket.instances[0].emit(snapshot)
  Socket.instances[0].close()
  t.mock.timers.tick(1000)
  await Promise.resolve()
  assert.equal(configs, 2)
  assert.equal(Socket.instances.length, 2)
  Socket.instances[0].emit(snapshot)
  assert.equal(events.length, 1)
  Socket.instances[1].emit(snapshot)
  assert.equal(events.length, 2)
  subscription.close()
  Socket.instances[1].emit(snapshot)
  t.mock.timers.tick(60_000)
  assert.equal(events.length, 2)
  assert.equal(configs, 2)
})

test('初始化配置尚未返回时关闭，不能遗留新的连接', async (t) => {
  const original = globalThis.WebSocket
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
  t.after(() => { globalThis.WebSocket = original })
  Socket.instances = []
  let resolve!: (value: { apiBaseUrl: string; apiToken: string; version: string }) => void
  const config = new Promise<{ apiBaseUrl: string; apiToken: string; version: string }>((done) => { resolve = done })
  const subscription = new NotificationSubscription({ config: () => config, receive() {}, warn() {} })
  const pending = subscription.start()
  subscription.close()
  resolve({ apiBaseUrl: 'http://127.0.0.1:8152', apiToken: 'fixture', version: 'test' })
  await pending
  assert.equal(Socket.instances.length, 0)
})
