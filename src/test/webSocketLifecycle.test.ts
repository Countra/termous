import assert from 'node:assert/strict'
import test from 'node:test'
import { retireWebSocket } from '../shared/webSocketLifecycle.ts'

class FakeWebSocket extends EventTarget {
  readyState = 0
  closeCalls = 0

  close() {
    this.closeCalls += 1
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  failHandshake() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

test('退役握手中的 WebSocket 会等待建立后只关闭一次', () => {
  const socket = new FakeWebSocket()

  retireWebSocket(socket as unknown as WebSocket)
  retireWebSocket(socket as unknown as WebSocket)
  assert.equal(socket.closeCalls, 0)

  socket.open()
  assert.equal(socket.closeCalls, 1)
})

test('握手失败后不会被迟到 open 事件再次关闭', () => {
  const socket = new FakeWebSocket()

  retireWebSocket(socket as unknown as WebSocket)
  socket.failHandshake()
  socket.open()

  assert.equal(socket.closeCalls, 0)
})

test('退役已建立的 WebSocket 会立即关闭', () => {
  const socket = new FakeWebSocket()
  socket.readyState = 1

  retireWebSocket(socket as unknown as WebSocket)

  assert.equal(socket.closeCalls, 1)
})
