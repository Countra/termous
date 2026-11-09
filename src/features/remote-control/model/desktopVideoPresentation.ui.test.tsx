import { afterEach, expect, test, vi } from 'vitest'
import { H264VideoAdapter } from '../../../../../termous-remote/browser/desktop/adapters/h264Video'

afterEach(() => vi.restoreAllMocks())

test('稳态视频逐帧确认 RTP，仅在首帧或尺寸变化时更新布局', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const video = document.createElement('video')
  Object.defineProperties(video, { videoWidth: { value: 1920, configurable: true }, videoHeight: { value: 1080, configurable: true } })
  const callbacks: VideoFrameRequestCallback[] = []
  video.requestVideoFrameCallback = vi.fn(cb => { callbacks.push(cb); return callbacks.length })
  video.cancelVideoFrameCallback = vi.fn()
  const ready = vi.fn(), failed = vi.fn(), observed = vi.fn(), presented = vi.fn()
  const adapter = new H264VideoAdapter(video, vi.fn(), ready, failed, observed, presented)
  try {
    adapter.mount({} as MediaStream)
    for (let i = 0; i < 60; i++) callbacks[i](0, { rtpTimestamp: i * 1500 } as VideoFrameCallbackMetadata)
    expect(presented).toHaveBeenCalledTimes(60)
    expect(presented).toHaveBeenLastCalledWith(59 * 1500)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledTimes(1)
    Object.defineProperty(video, 'videoWidth', { value: 1280 })
    video.dispatchEvent(new Event('resize'))
    expect(observed).toHaveBeenCalledTimes(2)
    expect(observed).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1280 }))
    // 回执导致会话结束时，不再登记下一帧回调。
    presented.mockImplementation(() => adapter.close())
    callbacks[60](0, { rtpTimestamp: 90000 } as VideoFrameCallbackMetadata)
    expect(callbacks).toHaveLength(61)
    expect(video.srcObject).toBeNull()
    expect(failed).not.toHaveBeenCalled()
  } finally { adapter.close() }
})
