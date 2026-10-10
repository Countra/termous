import { afterEach, expect, test, vi } from 'vitest'
import type { VncDesktopExecution } from './desktopExecution.ts'
import { connectVncExecution } from './executionBridge.ts'

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
