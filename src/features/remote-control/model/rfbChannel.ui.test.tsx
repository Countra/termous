import { describe, expect, it, vi } from 'vitest'
import { RfbChannel } from '@termous/remote-protocol/desktop'

describe('远端 RFB 通道关闭', () => {
  it('异步通知且只通知一次，不重入 noVNC 的关闭调用栈', async () => {
    const raw = { readyState: 'open', close: vi.fn() } as unknown as RTCDataChannel
    const failed = vi.fn()
    const channel = new RfbChannel(raw, vi.fn(), failed)
    let disconnectTimer: number | undefined
    const timeout = vi.fn()
    const closed = vi.fn(() => {
      window.clearTimeout(disconnectTimer)
      channel.close()
    })
    channel.onclose = closed
    vi.useFakeTimers()
    try {
      // 模拟 noVNC：先关闭底层传输，返回后才安装断开超时。
      channel.close()
      disconnectTimer = window.setTimeout(timeout, 3000)
      expect(closed).not.toHaveBeenCalled()
      expect(channel.readyState).toBe('closed')
      expect(() => channel.send(new Uint8Array([1]))).toThrow('desktop_rfb_unavailable')
      await Promise.resolve()
      channel.close()
      vi.advanceTimersByTime(3000)
      expect(closed).toHaveBeenCalledTimes(1)
      expect(failed).toHaveBeenCalledTimes(1)
      expect(raw.close).toHaveBeenCalledTimes(1)
      expect(timeout).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
