import { expect, test, vi } from 'vitest'
import { PresentationController, presentationPreset, videoDefaultCapabilities, type PresentationState } from '@termous/remote-protocol/presentation'

test('切换保留画质偏好，但拒绝旧媒体迟到的配置回执', async () => {
  vi.useFakeTimers()
  const state = (revision: bigint): PresentationState => ({ capabilities: videoDefaultCapabilities, revision, configRevision: revision, status: 'confirmed' })
  const replies: ((v: PresentationState) => void)[] = []
  const preference = { settings: presentationPreset('video', 'economy') }
  const configure = vi.fn(() => new Promise<PresentationState>(resolve => replies.push(resolve)))
  const c = new PresentationController({ configure }, vi.fn(), preference)
  try {
    c.update(state(8n)); await vi.advanceTimersByTimeAsync(300)
    c.observe({ width: 1920 })
    c.resetMedia(); c.update(state(1n)); await vi.advanceTimersByTimeAsync(300)
    expect(configure).toHaveBeenCalledTimes(2)
    replies[0](state(9n)); await Promise.resolve()
    expect(c.snapshot?.revision).toBe(1n)
    expect(c.snapshot?.observed).toBeUndefined()
    replies[1]({ ...state(2n), requested: preference.settings }); await Promise.resolve()
    expect(c.snapshot?.revision).toBe(2n)
    expect(c.snapshot?.requested).toEqual(preference.settings)
  } finally { c.dispose(); vi.useRealTimers() }
})
