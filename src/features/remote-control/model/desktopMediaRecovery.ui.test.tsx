import { create } from '@bufbuild/protobuf'
import { RemoteDesktopSession, type DesktopGateway, type DesktopPeerEvents } from '@termous/remote-protocol/desktop'
import { DesktopPacketSchema, DesktopResponseSchema, type DesktopResponse } from '@termous/remote-protocol/desktop-protocol'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ events: undefined as DesktopPeerEvents | undefined, close: vi.fn(), input: vi.fn(), resets: vi.fn(), resize: vi.fn(async () => {}) }))
vi.mock('../../../../../termous-remote/browser/desktop/peer.ts', () => ({
  DesktopPeer: class {
    ice = { id: 'fixture-negotiation', start() {} }
    constructor(_attachment: unknown, _ice: unknown, events: DesktopPeerEvents) { fixture.events = events }
    async offer() { return 'synthetic-offer' }
    async answer() {
      fixture.events?.track({} as MediaStream)
      fixture.events?.packet(create(DesktopPacketSchema, { state: { phase: 'first_frame', displayEpoch: 1n } }))
    }
    ready() {}
    resetInputSequence = fixture.resets
    close = fixture.close
    input = fixture.input
    resize = fixture.resize
  },
}))

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => vi.useRealTimers())

async function startRecoveryFixture(owned: boolean) {
  const control = { id: 'lease', owner: 'viewer', generation: 5n, expiresUnixMs: BigInt(Date.now() + 30_000), remainingMs: 30_000n }
  let release!: (value: DesktopResponse) => void
  const released = new Promise<DesktopResponse>(resolve => { release = resolve })
  const request = vi.fn(async (input: Parameters<DesktopGateway['request']>[0]) => {
    if (input.action === 'attach') return create(DesktopResponseSchema, { attachment: { id: 'attachment', participantId: 'viewer', transport: 'h264', connectionGeneration: 1n, mediaGeneration: 1n } })
    // 故意持续返回释放前的快照，验证在途查询不能复活旧租约。
    if (input.action === 'describe') return create(DesktopResponseSchema, { state: { available: true, phase: 'viewing', displayEpoch: 1n, width: 1920, height: 1080, capabilities: ['resize'], control: owned ? control : undefined } })
    if (input.action === 'release') return released
    if (input.action === 'offer') return create(DesktopResponseSchema, {sdp:'synthetic-answer', negotiationId: input.negotiationId})
    return create(DesktopResponseSchema)
  })
  const status = vi.fn()
  const runtime = new RemoteDesktopSession({ onICE: () => () => {}, capabilities: ['desktop-trickle-ice-v1'], request, ice: async () => [] }, 'session', 1n, { state: vi.fn(), status, clipboard: vi.fn(), challenge: vi.fn() })
  const video = document.createElement('video')
  video.play = vi.fn().mockResolvedValue(undefined)
  video.pause = vi.fn()
  video.requestVideoFrameCallback = callback => { callback(0, {} as VideoFrameCallbackMetadata); return 1 }
  await runtime.start(document.createElement('div'), video)
  await vi.advanceTimersByTimeAsync(0)
  return { runtime, request, status, release, video }
}

test('观察者短暂断线继续使用原附着，恢复不申请控制', async () => {
  const { runtime, request, status } = await startRecoveryFixture(false)
  try {
    fixture.events?.recovering?.(true)
    expect(status).toHaveBeenLastCalledWith('recovering')
    await expect(runtime.acquire(true)).rejects.toThrow('desktop_media_recovering')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(status).toHaveBeenLastCalledWith('recovering')
    fixture.events?.recovering?.(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenLastCalledWith('viewing')
    expect(request.mock.calls.filter(([r]) => ['detach', 'acquire', 'release'].includes(r.action ?? ''))).toHaveLength(0)
    expect(request.mock.calls.filter(([r]) => r.action === 'attach')).toHaveLength(1)
  } finally { await runtime.close() }
})

test('媒体统计失效和关闭清除观测值，保留已经确认的配置', async () => {
  const { runtime } = await startRecoveryFixture(false)
  const configured = {
    revision: 3n, configRevision: 2n, status: 'confirmed',
    capabilities: { kind: 'video' as const, available: true },
    requested: { kind: 'video' as const, size: 'auto' as const, framerate: 60, bitrate: 100_000_000 },
  }
  try {
    runtime.presentation.update(configured)
    fixture.events?.observation?.({ width: 1920, height: 1080, framerate: 60, bitrate: 10_000_000 })
    expect(runtime.presentation.snapshot?.observed?.framerate).toBe(60)
    fixture.events?.media?.(undefined)
    expect(runtime.presentation.snapshot).toMatchObject(configured)
    expect(runtime.presentation.snapshot?.observed).toBeUndefined()
    fixture.events?.observation?.({ framerate: 30 })
    await runtime.close()
    expect(runtime.presentation.snapshot?.observed).toBeUndefined()
    fixture.events?.observation?.({ framerate: 60 })
    expect(runtime.presentation.snapshot?.observed).toBeUndefined()
  } finally { await runtime.close() }
})

test('控制者恢复前释放按下状态，在途旧快照不能恢复控制或重放输入', async () => {
  const { runtime, request, status, release } = await startRecoveryFixture(true)
  try {
    expect(runtime.owned).toBe(true)
    fixture.events?.recovering?.(true)
    fixture.events?.recovering?.(false)
    expect(runtime.owned).toBe(false)
    expect(() => runtime.input({ kind: 'key', code: 'KeyA', down: true })).toThrow('desktop_control_locked')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(status).toHaveBeenLastCalledWith('recovering')
    release(create(DesktopResponseSchema))
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenLastCalledWith('viewing')
    expect(runtime.owned).toBe(false)
    expect(fixture.input).not.toHaveBeenCalled()
    expect(request.mock.calls.filter(([r]) => r.action === 'release')).toHaveLength(1)
    expect(request.mock.calls.filter(([r]) => r.action === 'acquire')).toHaveLength(0)
  } finally { await runtime.close() }
})

test('控制申请与媒体中断交错时回收附着，不认领迟到租约', async () => {
  const { runtime, request, status } = await startRecoveryFixture(false)
  let finish!: (value: DesktopResponse) => void
  request.mockImplementationOnce(() => new Promise<DesktopResponse>(resolve => { finish = resolve }))
  const acquiring = runtime.acquire(true)
  fixture.events?.recovering?.(true)
  fixture.events?.recovering?.(false)
  finish(create(DesktopResponseSchema, { control: { id: 'late', generation: 6n } }))
  await expect(acquiring).rejects.toThrow('desktop_control_interrupted')
  await runtime.close()
  expect(status).toHaveBeenLastCalledWith('closed', 'desktop_control_interrupted')
  expect(runtime.owned).toBe(false)
  expect(request.mock.calls.filter(([r]) => r.action === 'detach')).toHaveLength(1)
})

test('申请控制前发出的查询迟到时不能覆盖新租约或重置输入序号', async () => {
  const { runtime, request } = await startRecoveryFixture(false)
  let finish!: (value: DesktopResponse) => void
  request.mockImplementationOnce(() => new Promise<DesktopResponse>(resolve => { finish = resolve }))
  await vi.advanceTimersByTimeAsync(2_000)
  const control = { id: 'new-lease', owner: 'viewer', generation: 6n, expiresUnixMs: BigInt(Date.now() + 30_000), remainingMs: 30_000n }
  const original = request.getMockImplementation()!
  request.mockImplementation(input => input.action === 'describe'
    ? Promise.resolve(create(DesktopResponseSchema, { state: { available: true, phase: 'viewing', displayEpoch: 1n, control } }))
    : original(input))
  try {
    await runtime.acquire(true)
    expect(runtime.owned).toBe(true)
    const resets = fixture.resets.mock.calls.length
    finish(create(DesktopResponseSchema, { state: { available: true, phase: 'viewing', displayEpoch: 1n } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.owned).toBe(true)
    expect(runtime.controlGeneration).toBe(6n)
    expect(fixture.resets).toHaveBeenCalledTimes(resets)
  } finally { await runtime.close() }
})

test.each(['desktop_control_stale', 'desktop_not_ready', 'remote_disconnected'])(
  '恢复期间的迟到续租失败按原因处理：%s', async code => {
    const { runtime, request, status, release } = await startRecoveryFixture(true)
    let rejectRenew!: (reason: Error) => void
    const original = request.getMockImplementation()!
    request.mockImplementation(input => input.action === 'renew'
      ? new Promise<DesktopResponse>((_resolve, reject) => { rejectRenew = reject })
      : original(input))
    await vi.advanceTimersByTimeAsync(12_000)
    expect(rejectRenew).toBeDefined()
    fixture.events?.recovering?.(true)
    fixture.events?.recovering?.(false)
    release(create(DesktopResponseSchema))
    await vi.advanceTimersByTimeAsync(0)
    rejectRenew(new Error(code))
    await vi.advanceTimersByTimeAsync(2_000)
    try {
      expect(runtime.owned).toBe(false)
      if (code === 'remote_disconnected') expect(status).toHaveBeenLastCalledWith('closed', code)
      else {
        expect(status).toHaveBeenLastCalledWith('viewing')
        expect(request.mock.calls.filter(([r]) => r.action === 'detach')).toHaveLength(0)
      }
    } finally { await runtime.close() }
  },
)

test('主动释放立即停止输入，迟到状态不能恢复已经释放的租约', async () => {
  const { runtime, release } = await startRecoveryFixture(true)
  const releasing = runtime.release()
  try {
    expect(runtime.owned).toBe(false)
    release(create(DesktopResponseSchema))
    await releasing
    await vi.advanceTimersByTimeAsync(2_000)
    expect(runtime.owned).toBe(false)
  } finally { release(create(DesktopResponseSchema)); await releasing; await runtime.close() }
})

test('关闭视频附着清理播放器，迟到的视频事件不会重新挂载媒体', async () => {
  const { runtime, video } = await startRecoveryFixture(false)
  video.pause = vi.fn()
  await runtime.close()
  expect(video.srcObject).toBeNull()
  fixture.events?.track({} as MediaStream)
  expect(video.srcObject).toBeNull()
  expect(video.play).toHaveBeenCalledTimes(1)
})

test.each(['describe', 'renew'])('暂时忙碌的 %s 不结束桌面或重放输入', async action => {
  const { runtime, request, status } = await startRecoveryFixture(true)
  const original = request.getMockImplementation()!
  let busy = true
  request.mockImplementation(input => {
    if (input.action === action && busy) { busy = false; return Promise.reject(new Error('desktop_busy')) }
    return original(input)
  })
  try {
    await vi.advanceTimersByTimeAsync(14_000)
    expect(busy).toBe(false)
    expect(runtime.owned).toBe(true)
    expect(status).not.toHaveBeenCalledWith('closed', expect.anything())
    expect(request.mock.calls.filter(([input]) => input.action === 'detach')).toHaveLength(0)
    expect(fixture.input).not.toHaveBeenCalled()
  } finally { await runtime.close() }
})

test('续租发现控制权被收回时继续观看，不抢占旧租约', async () => {
  const { runtime, request, status } = await startRecoveryFixture(true)
  const original = request.getMockImplementation()!
  request.mockImplementation(input => input.action === 'renew' ? Promise.reject(new Error('desktop_control_stale')) : original(input))
  try {
    await vi.advanceTimersByTimeAsync(14_000)
    expect(runtime.owned).toBe(false)
    expect(status).toHaveBeenLastCalledWith('viewing')
    expect(request.mock.calls.filter(([input]) => ['detach', 'acquire'].includes(input.action ?? ''))).toHaveLength(0)
  } finally { await runtime.close() }
})

test('新租约不会立即续租，持续忙碌也不能延长本地控制有效期', async () => {
  const { runtime, request, status } = await startRecoveryFixture(true)
  const original = request.getMockImplementation()!
  request.mockImplementation(input => input.action === 'renew' ? Promise.reject(new Error('desktop_busy')) : original(input))
  try {
    await vi.advanceTimersByTimeAsync(8_000)
    expect(request.mock.calls.filter(([input]) => input.action === 'renew')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(24_000)
    expect(runtime.owned).toBe(false)
    expect(() => runtime.input({ kind: 'key', code: 'KeyA', down: true })).toThrow('desktop_control_locked')
    expect(fixture.input).not.toHaveBeenCalled()
    expect(status).toHaveBeenLastCalledWith('viewing')
    expect(request.mock.calls.filter(([input]) => ['detach', 'acquire'].includes(input.action ?? ''))).toHaveLength(0)
  } finally { await runtime.close() }
})

test('RDP 尺寸回执后继续禁止旧坐标输入，缺少尺寸通知时安全重附着', async () => {
  const { runtime, status } = await startRecoveryFixture(true)
  try {
    await runtime.resize(1280, 720)
    await vi.advanceTimersByTimeAsync(300)
    expect(fixture.resize).toHaveBeenCalledOnce()
    expect(runtime.owned).toBe(false)
    expect(() => runtime.input({ kind: 'move', x: 1, y: 1 })).toThrow('desktop_control_locked')
    await expect(runtime.acquire(true)).rejects.toThrow('desktop_busy')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(status).toHaveBeenLastCalledWith('closed', 'desktop_display_changed')
    expect(fixture.input).not.toHaveBeenCalled()
  } finally { await runtime.close() }
})

test('RDP 尺寸请求被明确拒绝后恢复原坐标输入', async () => {
  const { runtime } = await startRecoveryFixture(true)
  fixture.resize.mockRejectedValueOnce(new Error('desktop_resize_rejected'))
  try {
    await runtime.resize(1280, 720)
    await vi.advanceTimersByTimeAsync(300)
    expect(runtime.owned).toBe(true)
    runtime.input({ kind: 'move', x: 1, y: 1 })
    expect(fixture.input).toHaveBeenCalledOnce()
  } finally { await runtime.close() }
})
