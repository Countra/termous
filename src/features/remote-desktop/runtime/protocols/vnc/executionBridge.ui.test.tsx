import { afterEach, expect, test, vi } from 'vitest'
import type { VncDesktopExecution } from './desktopExecution.ts'
import { connectVncExecution } from './executionBridge.ts'
import { serveVncExecution, type ExecutionChannel } from '@termous/remote-protocol/vnc'

class BridgeSocket {
  static current: BridgeSocket
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  onmessage?: (event: MessageEvent) => void
  close = vi.fn()
  constructor() { BridgeSocket.current = this }
}

afterEach(() => vi.unstubAllGlobals())

test('执行端清理失败仍关闭通道并通知观看端，重复关闭只通知一次', async () => {
  vi.stubGlobal('WebSocket', BridgeSocket)
  const failed = vi.fn()
  const execution = { dispose: vi.fn(() => { throw new Error('reset failed') }) }
  const abort = new AbortController()
  await connectVncExecution({ connect: async () => ({ url: 'ws://localhost/fixture', ticket: 'fixture' }), reclaim: async () => {} }, execution as unknown as VncDesktopExecution, abort.signal, failed, false)
  BridgeSocket.current.onclose?.()
  BridgeSocket.current.onclose?.()
  abort.abort()
  expect(failed).toHaveBeenCalledTimes(1)
  expect(BridgeSocket.current.close).toHaveBeenCalledTimes(1)
  expect(execution.dispose).toHaveBeenCalledTimes(1)
})

test.each([true, false])('执行桥接取消后不处理迟到的打开和输入事件（预先取消：%s）', preAborted => {
  const socket: ExecutionChannel = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: null, onclose: null, onerror: null, onmessage: null }
  const unwatch = vi.fn()
  const execution = { dispose: vi.fn(), watchState: vi.fn(() => unwatch), execute: vi.fn() }
  const abort = new AbortController(), authenticate = vi.fn(), failed = vi.fn()
  if (preAborted) abort.abort()
  const stop = serveVncExecution(socket, execution as unknown as VncDesktopExecution, abort.signal, failed, authenticate)
  const opened = socket.onopen, received = socket.onmessage
  abort.abort()
  opened?.()
  received?.({ data: JSON.stringify({ id: '1', action: 'input', input: {} }) })
  stop()
  expect(authenticate).toHaveBeenCalledTimes(preAborted ? 0 : 1)
  expect(execution.execute).not.toHaveBeenCalled()
  expect(execution.dispose).toHaveBeenCalledTimes(1)
  expect(socket.close).toHaveBeenCalledTimes(1)
  expect(socket.onmessage).toBeNull()
  expect(failed).not.toHaveBeenCalled()
})
