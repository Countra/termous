import type RFB from '@novnc/novnc'
import { afterEach, expect, test, vi } from 'vitest'
import { VncDisplay } from './display.ts'

afterEach(() => vi.useRealTimers())

test('初始化回调失败时释放观察器与协议监听，不遗留跟随请求', async () => {
  vi.useFakeTimers()
  const target = document.createElement('div')
  const rfb = Object.assign(new EventTarget(), { resizeSession: false, capabilities: { resize: true },
    desktopState: { width: 1920, height: 1080, sequence: 1 }, requestDesktopSize: vi.fn() })
  const remove = vi.spyOn(rfb, 'removeEventListener')
  const changed = vi.fn(() => { throw new Error('fixture callback') })
  expect(() => new VncDisplay(rfb as unknown as RFB, target, () => true, true, changed)).toThrow('fixture callback')
  expect(remove.mock.calls.map(([name]) => name)).toEqual(['desktopframe', 'capabilities', 'desktopresize'])
  rfb.dispatchEvent(new Event('desktopframe'))
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(rfb.requestDesktopSize).not.toHaveBeenCalled()
})

test('失去控制时保留跟随意图，恢复控制后发送，返回固定恢复原尺寸', async () => {
  vi.useFakeTimers()
  const target = document.createElement('div')
  Object.defineProperties(target, { clientWidth: { value: 1280 }, clientHeight: { value: 720 } })
  const rfb = Object.assign(new EventTarget(), {
    resizeSession: false, capabilities: { resize: true },
    desktopState: { width: 1920, height: 1080, sequence: 1 }, requestDesktopSize: vi.fn(() => true),
  })
  let owned = false
  const changed = vi.fn()
  const display = new VncDisplay(rfb as unknown as RFB, target, () => owned, true, changed)
  try {
    await vi.advanceTimersByTimeAsync(1000)
    expect(rfb.requestDesktopSize).not.toHaveBeenCalled()
    expect(changed.mock.lastCall?.[0].status).toBe('waiting')
    owned = true
    display.refresh()
    await vi.advanceTimersByTimeAsync(300)
    expect(rfb.requestDesktopSize).toHaveBeenCalledExactlyOnceWith(1280, 720)
    rfb.dispatchEvent(new CustomEvent('desktopresize', { detail: { success: true } }))
    rfb.desktopState = { width: 1280, height: 720, sequence: 2 }
    rfb.dispatchEvent(new Event('desktopframe'))
    await vi.advanceTimersByTimeAsync(0)
    display.setFollowWindow(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(rfb.requestDesktopSize).toHaveBeenLastCalledWith(1920, 1080)
    rfb.dispatchEvent(new CustomEvent('desktopresize', { detail: { success: false } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(changed.mock.lastCall?.[0].status).toBe('failed')
    expect(rfb.requestDesktopSize).toHaveBeenCalledTimes(2)
  } finally { display.dispose() }
})
