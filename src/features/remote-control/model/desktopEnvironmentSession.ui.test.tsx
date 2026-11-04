import { create } from '@bufbuild/protobuf'
import { afterEach, expect, test, vi } from 'vitest'
import { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { DesktopEnvironmentSchema, DesktopPacketSchema, DesktopResponseSchema, DesktopTargetSchema, type DesktopEnvironment, type DesktopResponse } from '@termous/remote-protocol/desktop-protocol'
import type { DesktopPeerEvents } from '../../../../../termous-remote/browser/desktop/peer'

const mocks = vi.hoisted(() => ({ peers: [] as { events: DesktopPeerEvents; ready: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] }))
vi.mock('../../../../../termous-remote/browser/desktop/peer.js', () => ({
  DesktopPeer: class {
    ready = vi.fn(); close = vi.fn(); resetInputSequence = vi.fn(); setPresentation = vi.fn()
    constructor(_a: unknown, _ice: unknown, public events: DesktopPeerEvents) { mocks.peers.push(this) }
    async offer() { return 'offer' }
    async answer() {}
  },
}))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); mocks.peers.length = 0 })

test.each(['desktop_stale', 'remote_request_timeout'])('两次切换保持附着和授权，忽略旧查询 %s 并只确认当前首帧', async failure => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const video = document.createElement('video'), root = document.createElement('div')
  root.append(video)
  Object.defineProperties(video, { videoWidth: { value: 0, configurable: true }, videoHeight: { value: 0, configurable: true } })
  const frames: VideoFrameRequestCallback[] = []
  video.requestVideoFrameCallback = cb => { frames.push(cb); return frames.length }
  video.cancelVideoFrameCallback = vi.fn()
  const draw = vi.fn(() => expect(video.srcObject).not.toBeNull())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  const capability = 'desktop-environment-switch-v1'
  const attachment = { id: 'view', transport: 'h264', attachmentGeneration: 1n, mediaGeneration: 1n, participantId: 'viewer', capabilities: [capability] }
  const target = create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'core', sourceId: 'display', sourceGeneration: 1n, sourceKind: 'screen' })
  let env = create(DesktopEnvironmentSchema, { attachment, revision: 1n, switchId: 1n, phase: 'preparing', remainingMs: 20_000n })
  let notify!: (value: DesktopEnvironment) => void
  let holdDescribe = false, rejectDescribe: ((reason: Error) => void) | undefined
  const request = vi.fn(async (input: { action?: string }) => {
    if (input.action === 'describe' && holdDescribe) {
      holdDescribe = false
      return new Promise<DesktopResponse>((_resolve, reject) => { rejectDescribe = reject })
    }
    return create(DesktopResponseSchema, input.action === 'attach' ? { attachment } : input.action === 'environment_status' ? { environment: env } : input.action === 'offer' ? { sdp: 'answer' } : {})
  })
  const status = vi.fn(), reset = vi.fn()
  const session = new RemoteDesktopSession({ request, ice: async () => [], capabilities: [capability], onEnvironment: cb => { notify = cb; return () => {} } }, '', 0n, {
    state: vi.fn(), status, inputReset: reset, clipboard: vi.fn(), challenge: vi.fn(),
  }, {}, target)
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const packet = (generation: bigint, phase: string) => create(DesktopPacketSchema, { state: {
    target, attachmentId: 'view', mediaGeneration: generation, displayEpoch: generation, phase, width: 1920, height: 1080, available: true,
    ...(phase === 'viewing' ? { control: { id: 'lease', owner: 'viewer', generation, remainingMs: 30_000n, expiresUnixMs: 100_000n } } : {}),
  } })
  try {
    await session.start(root, video); await flush()
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } })
    session.display(false)
    for (let i = 0; i < 3; i++) {
      const generation = BigInt(i + 1), peer = mocks.peers[i]
      peer.events.track({ id: `stream-${i}` } as MediaStream)
      peer.events.packet(packet(generation, 'first_frame'))
      expect(session.owned).toBe(false)
      frames[frames.length - 1]!(0, {} as VideoFrameCallbackMetadata)
      expect(peer.ready).toHaveBeenCalledWith(generation)
      expect(session.owned).toBe(false)
      peer.events.packet(packet(generation, 'viewing'))
      expect(session.owned).toBe(true)
      expect(video.style.width).toBe('1920px')
      if (i < 2) {
        if (i === 0) {
          holdDescribe = true
          await vi.advanceTimersByTimeAsync(2_000)
          expect(rejectDescribe).toBeDefined()
        }
        const oldFrame = frames[frames.length - 1]!
        env = create(DesktopEnvironmentSchema, { attachment: { ...attachment, mediaGeneration: generation + 1n }, revision: generation + 1n, switchId: generation + 1n, phase: 'switching', remainingMs: 20_000n })
        notify(env); await flush()
        expect(session.owned).toBe(false)
        expect(mocks.peers).toHaveLength(i + 2)
        oldFrame(0, {} as VideoFrameCallbackMetadata)
        peer.events.packet(packet(generation, 'viewing'))
        expect(mocks.peers[i + 1].ready).not.toHaveBeenCalled()
        expect(session.owned).toBe(false)
        if (i === 0) { rejectDescribe!(new Error(failure)); await flush() }
      }
    }
    expect(draw).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.filter(([v]) => v.action === 'attach')).toHaveLength(1)
    expect(status.mock.calls.some(([v]) => v === 'closed')).toBe(false)
  } finally { await session.close() }
  expect(request.mock.calls.filter(([v]) => v.action === 'detach')).toHaveLength(1)
})
