import type RFB from '@novnc/novnc'
import { afterEach, expect, test, vi } from 'vitest'
import { PresentationController, presentationPreset, videoDefaultCapabilities, type PresentationState, type PresentationSettings } from '@termous/remote-protocol/presentation'
import { resizeVnc, VncPresentation } from '@termous/remote-protocol/vnc'

afterEach(() => vi.useRealTimers())
const initial = (): PresentationState => ({ capabilities: videoDefaultCapabilities, requested: presentationPreset('video', 'clear'), revision: 0n, configRevision: 1n, status: 'confirmed' })

test('快速设置只合并最新意图，同一通道只有一个在途请求', async () => {
  vi.useFakeTimers()
  const waiting: ((state: PresentationState) => void)[] = []
  const calls: PresentationSettings[] = []
  const controller = new PresentationController({ configure: settings => { calls.push(settings); return new Promise(resolve => waiting.push(resolve)) } }, vi.fn())
  controller.update(initial())
  controller.set(presentationPreset('video', 'balanced'))
  controller.set(presentationPreset('video', 'economy'))
  await vi.advanceTimersByTimeAsync(300)
  expect(calls).toEqual([presentationPreset('video', 'economy')])
  controller.set(presentationPreset('video', 'clear'))
  await vi.advanceTimersByTimeAsync(300)
  expect(calls).toHaveLength(1)
  waiting[0]({ ...initial(), revision: 1n, requested: calls[0] })
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(presentationPreset('video', 'clear'))
  controller.dispose()
})

test('较旧的状态不能回退设置，重建观看端恢复会话偏好', async () => {
  vi.useFakeTimers()
  const preference = { settings: presentationPreset('video', 'economy') }
  const configure = vi.fn(async (settings: PresentationSettings) => ({ ...initial(), requested: settings, revision: 2n, configRevision: 3n }))
  const controller = new PresentationController({ configure }, vi.fn(), preference)
  controller.update(initial())
  await vi.advanceTimersByTimeAsync(300)
  controller.update({ ...initial(), revision: 2n, configRevision: 3n, status: 'pending' })
  expect(controller.snapshot?.requested).toEqual(preference.settings)
  expect(controller.snapshot?.status).toBe('confirmed')
  controller.dispose()
  const replacement = new PresentationController({ configure }, vi.fn(), preference)
  replacement.update(initial())
  await vi.advanceTimersByTimeAsync(300)
  expect(configure).toHaveBeenCalledTimes(2)
  replacement.dispose()
})

test('查询已确认应用后，设置请求的迟到传输失败不能覆盖成功状态', async () => {
  vi.useFakeTimers()
  let reject!: (error: Error) => void
  const controller = new PresentationController({ configure: () => new Promise<PresentationState>((_, failed) => { reject = failed }) }, vi.fn())
  controller.update(initial())
  const requested = presentationPreset('video', 'economy')
  controller.set(requested)
  await vi.advanceTimersByTimeAsync(300)
  controller.update({ ...initial(), requested, revision: 1n, configRevision: 2n })
  reject(new Error('remote_request_timeout'))
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.snapshot?.status).toBe('confirmed')
  expect(controller.snapshot?.error).toBeUndefined()
  controller.dispose()
})

class RfbFixture extends EventTarget {
  capabilities = { resize: true }
  desktopState = { width: 800, height: 600, sequence: 1 }
  qualityLevel = 0
  compressionLevel = 0
  requestDesktopSize = vi.fn(() => true)
}

test('VNC 只确认偏好发送，不声明已采用或无损', async () => {
  const rfb = new RfbFixture()
  const adapter = new VncPresentation(rfb as unknown as RFB)
  expect(rfb.qualityLevel).toBe(9)
  const result = await adapter.configure(presentationPreset('rfb', 'economy'), 'operation-1', 0n)
  expect([rfb.qualityLevel, rfb.compressionLevel]).toEqual([3, 6])
  expect(result.status).toBe('preference_sent')
  expect(result.applied).toBeUndefined()
})

test('VNC 必须同时等到回执与完整新画面', async () => {
  const rfb = new RfbFixture()
  const done = vi.fn()
  const pending = resizeVnc(rfb as unknown as RFB, 1280, 720).then(done)
  rfb.dispatchEvent(new CustomEvent('desktopresize', { detail: { success: true } }))
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  rfb.desktopState = { width: 1280, height: 720, sequence: 0 }
  rfb.dispatchEvent(new Event('desktopframe'))
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  rfb.desktopState.sequence = 2
  rfb.dispatchEvent(new Event('desktopframe'))
  await pending
  expect(done).toHaveBeenCalledOnce()
})

test('VNC 明确拒绝与超时未确认分别返回，不自行重连', async () => {
  vi.useFakeTimers()
  const rfb = new RfbFixture()
  const rejected = resizeVnc(rfb as unknown as RFB, 1280, 720)
  const rejection = expect(rejected).rejects.toThrow('desktop_resize_rejected')
  rfb.dispatchEvent(new CustomEvent('desktopresize', { detail: { success: false } }))
  await rejection
  const timeout = expect(resizeVnc(rfb as unknown as RFB, 1280, 720)).rejects.toThrow('desktop_resize_unconfirmed')
  await vi.advanceTimersByTimeAsync(10_000)
  await timeout
})
