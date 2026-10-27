import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopControlSnapshot } from '#common/contracts'
import { subscribeDesktopControls } from './subscribe.ts'

class Socket extends EventTarget {
  readyState = 0
  closeCalls = 0
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  close() { this.closeCalls++; this.readyState = 2 }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const snapshot: DesktopControlSnapshot = { instance_id: 'core', controls: [] }

test('异常消息或连接错误立即清空展示，不等待关闭握手且忽略迟到快照', t => {
  for (const failure of ['message', 'error']) {
    const socket = new Socket()
    t.mock.method(globalThis, 'WebSocket', function () { return socket })
    const received: (DesktopControlSnapshot | null)[] = []
    const stop = subscribeDesktopControls(() => 'ws://127.0.0.1/events', value => received.push(value))
    try {
      socket.open()
      socket.message(snapshot)
      assert.deepEqual(received, [snapshot])
      if (failure === 'message') socket.message({ invalid: true })
      else socket.onerror?.()
      assert.equal(received[received.length - 1], null)
      socket.message(snapshot)
      assert.equal(received[received.length - 1], null)
      assert.equal(socket.closeCalls, 1)
    } finally { stop(); t.mock.restoreAll() }
  }
})

test('订阅在握手完成前卸载时复用安全退役机制，不再接受状态', t => {
  const socket = new Socket()
  t.mock.method(globalThis, 'WebSocket', function () { return socket })
  const received: (DesktopControlSnapshot | null)[] = []
  const stop = subscribeDesktopControls(() => 'ws://127.0.0.1/events', value => received.push(value))
  stop()
  assert.equal(socket.closeCalls, 0)
  socket.open()
  assert.equal(socket.closeCalls, 1)
  socket.message(snapshot)
  assert.deepEqual(received, [])
})
