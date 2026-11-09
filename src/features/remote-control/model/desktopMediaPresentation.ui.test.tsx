import { expect, test, vi } from 'vitest'
import { PresentationController, presentationPreset, videoDefaultCapabilities, type PresentationState } from '@termous/remote-protocol/presentation'

test('内容恢复仅清空观察，保留画质请求并拒绝迟到的低修订配置回执', async () => {
  vi.useFakeTimers()
  const state = (revision: bigint): PresentationState => ({ capabilities: videoDefaultCapabilities, revision, configRevision: revision, status: 'confirmed' })
  const replies: ((v: PresentationState) => void)[] = []
  const preference = { settings: presentationPreset('video', 'economy') }
  const configure = vi.fn(() => new Promise<PresentationState>(resolve => replies.push(resolve)))
  const c = new PresentationController({ configure }, vi.fn(), preference)
  try {
    c.update(state(8n)); await vi.advanceTimersByTimeAsync(300)
    c.observe({ width: 1920 })
    c.clearObservation(); c.update({ ...state(10n), requested: preference.settings }); await vi.advanceTimersByTimeAsync(300)
    expect(configure).toHaveBeenCalledTimes(1)
    replies[0](state(9n)); await Promise.resolve()
    expect(c.snapshot?.revision).toBe(10n)
    expect(c.snapshot?.observed).toBeUndefined()
    expect(c.snapshot?.requested).toEqual(preference.settings)
  } finally { c.dispose(); vi.useRealTimers() }
})
