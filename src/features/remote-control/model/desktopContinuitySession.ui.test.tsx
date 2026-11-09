import { create } from '@bufbuild/protobuf'
import { afterEach, expect, test, vi } from 'vitest'
import { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { DesktopStreamStateSchema, DesktopPacketSchema, DesktopResponseSchema, DesktopTargetSchema, type DesktopStreamState } from '@termous/remote-protocol/desktop-protocol'
import type { DesktopPeerEvents } from '../../../../../termous-remote/browser/desktop/peer'

const mocks = vi.hoisted(() => ({ peers: [] as { events: DesktopPeerEvents; presented: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] }))
vi.mock('../../../../../termous-remote/browser/desktop/peer.js', () => ({
  DesktopPeer: class {
    ready = vi.fn(); presented = vi.fn(); close = vi.fn(); resetInputSequence = vi.fn(); setPresentation = vi.fn()
    constructor(_a: unknown, _ice: unknown, public events: DesktopPeerEvents) { mocks.peers.push(this) }
    async offer() { return 'offer' }
    async answer() {}
  },
}))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); mocks.peers.length = 0 })

test('连续切换保持同一个 Peer、Track、附着与播放器，实际呈现后等待主机开放输入', async () => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const video = document.createElement('video'), root = document.createElement('div')
  root.append(video)
  Object.defineProperties(video, { videoWidth: { value: 1920, configurable: true }, videoHeight: { value: 1080, configurable: true } })
  const frames: VideoFrameRequestCallback[] = []
  video.requestVideoFrameCallback = cb => { frames.push(cb); return frames.length }
  video.cancelVideoFrameCallback = vi.fn()
  const drawing = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  const capability = 'desktop-continuous-stream-v1'
  const attachment = { id: 'view', transport: 'h264', attachmentGeneration: 1n, mediaGeneration: 1n, participantId: 'viewer', capabilities: [capability] }
  const target = create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'core', sourceId: 'display', sourceGeneration: 1n, sourceKind: 'screen' })
  let state = create(DesktopStreamStateSchema, { attachment, streamId: 'view', revision: 1n, status: 'recovering' })
  let notify!: (value: DesktopStreamState) => void
  const request = vi.fn(async (input: { action?: string }) => create(DesktopResponseSchema,
    input.action === 'attach' ? { attachment } : input.action === 'stream_status' ? { streamState: state } : input.action === 'offer' ? { sdp: 'answer' } : {}))
  const status = vi.fn(), reset = vi.fn(), updated = vi.fn()
  const session = new RemoteDesktopSession({ request, ice: async () => [], capabilities: [capability], onStreamState: cb => { notify = cb; return () => {} } }, '', 0n, {
    state: updated, status, inputReset: reset, clipboard: vi.fn(), challenge: vi.fn(),
  }, {}, target)
  try {
    await session.start(root, video)
    expect(status).toHaveBeenLastCalledWith('connecting')
    const peer = mocks.peers[0], stream = { id: 'stable-track' } as MediaStream
    peer.events.track(stream)
    session.display(false)
    for (let i = 1; i <= 3; i++) {
      const epoch = BigInt(i), revision = BigInt(i * 3), timestamp = i * 90000
      if (i === 2) peer.events.recovering?.(true)
      state = create(DesktopStreamStateSchema, { attachment, streamId: 'view', revision, status: 'recovering', displayEpoch: epoch, boundary: { id: epoch, rtpTimestamp: timestamp } })
      notify(state)
      if (i === 2) {
        peer.events.recovering?.(false)
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(session.owned).toBe(false)
      expect(session.controlAvailable).toBe(false)
      // 超过旧遮罩期限仍保留视频，输入不可用通过状态通知刷新工具栏。
      await vi.advanceTimersByTimeAsync(1_500)
      expect(status).toHaveBeenLastCalledWith(i === 1 ? 'connecting' : 'viewing')
      expect(video.srcObject).toBe(stream)
      expect(video.style.visibility).not.toBe('hidden')
      expect(root.querySelectorAll('canvas')).toHaveLength(0)
      if (i > 1) expect(updated).toHaveBeenCalled()
      frames[frames.length - 1](0, { rtpTimestamp: timestamp - 1 } as VideoFrameCallbackMetadata)
      expect(peer.presented).toHaveBeenCalledTimes(i - 1)
      frames[frames.length - 1](0, { rtpTimestamp: timestamp } as VideoFrameCallbackMetadata)
      expect(peer.presented).toHaveBeenLastCalledWith({ streamId: 'view', displayEpoch: epoch, boundaryId: epoch, rtpTimestamp: timestamp })
      expect(session.owned).toBe(false)
      state = { ...state, revision: revision + 1n, status: 'ready', inputAvailable: true }
      // 父连接可先于控制快照送达就绪；旧租约不能在新内容上短暂开放。
      notify(state)
      expect(session.controlAvailable).toBe(false)
      expect(session.owned).toBe(false)
      await expect(session.acquire(false)).rejects.toThrow('desktop_busy')
      peer.events.packet(create(DesktopPacketSchema, { state: { target, attachmentId: 'view', mediaGeneration: 1n, displayEpoch: epoch, width: 1920, height: 1080, available: true,
        phase: 'viewing', streamState: state, control: { id: 'lease', owner: 'viewer', generation: epoch, remainingMs: 30_000n, expiresUnixMs: 100_000n } } }))
      expect(session.owned).toBe(true)
      expect(session.controlAvailable).toBe(true)
      expect(video.srcObject).toBe(stream)
      expect(video.style.width).toBe('1920px')
      expect(mocks.peers).toHaveLength(1)
      expect(peer.close).not.toHaveBeenCalled()
    }
    expect(request.mock.calls.filter(([v]) => v.action === 'attach')).toHaveLength(1)
    expect(request.mock.calls.filter(([v]) => v.action === 'offer')).toHaveLength(1)
    expect(status.mock.calls.some(([v]) => v === 'closed')).toBe(false)
    expect(reset).toHaveBeenCalled()
    expect(drawing).not.toHaveBeenCalled()
    for (const [index, pause] of ['paused', 'restricted'].entries()) {
      state = { ...state, revision: BigInt(20 + index * 2), status: pause, reason: pause === 'restricted' ? 'desktop_access_restricted' : 'desktop_window_paused' }
      notify(state)
      expect(status).toHaveBeenLastCalledWith('paused', state.reason)
      expect(session.owned).toBe(false)
      expect(session.controlAvailable).toBe(false)
      state = { ...state, revision: state.revision + 1n, status: 'recovering' }
      notify(state)
      expect(status).toHaveBeenLastCalledWith('paused', state.reason)
    }
    notify({ ...state, revision: 30n, status: 'failed', reason: 'desktop_stream_recovery_timeout' })
    expect(status).toHaveBeenLastCalledWith('closed', 'desktop_stream_recovery_timeout')
  } finally { await session.close() }
  expect(request.mock.calls.filter(([v]) => v.action === 'detach')).toHaveLength(1)
  expect(mocks.peers[0].close).toHaveBeenCalledTimes(1)
})
