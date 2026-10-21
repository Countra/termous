import { create } from '@bufbuild/protobuf'
import { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { DesktopResponseSchema } from '@termous/remote-protocol/desktop-protocol'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  rfb: undefined as (EventTarget & { desktopState: { sequence: number }; disconnect: ReturnType<typeof vi.fn> }) | undefined,
  execution: vi.fn(), start: vi.fn(), resume: vi.fn(), ready: vi.fn(),
}))

vi.mock('../../../../../termous-remote/node_modules/@novnc/novnc/core/rfb.js', () => ({
  default: class extends EventTarget {
    desktopState = { width: 800, height: 600, sequence: 0, displayEpoch: 1, flushing: false }
    disconnect = vi.fn()
    constructor() { super(); fixture.rfb = this }
    // 使用真实依赖的选项语义，避免 DOM EventTarget 替身掩盖监听器泄漏。
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) { super.addEventListener(type, listener) }
  },
}))

vi.mock('../../../../../termous-remote/browser/desktop/peer.ts', () => ({
  DesktopPeer: class {
    rfb = { start: fixture.start, resume: fixture.resume }
    constructor(readonly attachment: unknown) {}
    async offer() { return 'fixture-offer' }
    async answer() {}
    close() {}
    resetInputSequence() {}
    ready = fixture.ready
    executionChannel = fixture.execution
  },
}))

const sessions: RemoteDesktopSession[] = []
beforeEach(() => {
  vi.clearAllMocks()
  fixture.start.mockReset()
  fixture.execution.mockImplementation(() => ({ readyState: 0, bufferedAmount: 0, send: vi.fn(), close: vi.fn() }))
})
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())) })

async function setup() {
  const request = vi.fn(async (input: { action?: string }) => {
    if (input.action === 'attach') return create(DesktopResponseSchema, { attachment: { id: 'attachment', participantId: 'viewer', transport: 'rfb', connectionGeneration: 1n, mediaGeneration: 1n } })
    if (input.action === 'describe') return create(DesktopResponseSchema, { state: { available: true, phase: 'viewing' } })
    return create(DesktopResponseSchema)
  })
  const events = { state: vi.fn(), status: vi.fn(), clipboard: vi.fn(), challenge: vi.fn() }
  const session = new RemoteDesktopSession({ request, ice: async () => [] }, 'fixture', 1n, events)
  sessions.push(session)
  await session.start(document.createElement('div'), document.createElement('video'))
  return { session, events, rfb: fixture.rfb! }
}

test('VNC 重复连接和画面通知只创建一个执行端，关闭后不再恢复消费或转发剪贴板', async () => {
  const f = await setup()
  f.rfb.desktopState.sequence = 1
  f.rfb.dispatchEvent(new Event('connect'))
  f.rfb.dispatchEvent(new Event('connect'))
  f.rfb.dispatchEvent(new Event('desktopframe'))
  expect(fixture.execution).toHaveBeenCalledTimes(1)
  expect(fixture.ready).toHaveBeenCalledTimes(1)
  await f.session.close()
  fixture.resume.mockClear()
  f.rfb.dispatchEvent(new Event('desktopframe'))
  f.rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text: 'late' } }))
  await Promise.resolve()
  expect(fixture.resume).not.toHaveBeenCalled()
  expect(f.events.clipboard).not.toHaveBeenCalled()
  expect(f.rfb.disconnect).toHaveBeenCalledTimes(1)
})

test('等待首帧时关闭，迟到画面不能重建执行端', async () => {
  const f = await setup()
  f.rfb.dispatchEvent(new Event('connect'))
  await f.session.close()
  f.rfb.desktopState.sequence = 1
  f.rfb.dispatchEvent(new Event('desktopframe'))
  expect(fixture.execution).not.toHaveBeenCalled()
  expect(fixture.ready).not.toHaveBeenCalled()
})

test('VNC 通道启动失败释放已创建播放器，不遗留凭据和剪贴板事件', async () => {
  fixture.start.mockImplementation(() => { throw new Error('desktop_rfb_unavailable') })
  const f = await setup()
  expect(f.rfb.disconnect).toHaveBeenCalledTimes(1)
  f.rfb.dispatchEvent(new CustomEvent('credentialsrequired', { detail: { types: ['password'] } }))
  f.rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text: 'late' } }))
  expect(f.events.challenge).not.toHaveBeenCalled()
  expect(f.events.clipboard).not.toHaveBeenCalled()
  expect(f.events.status).toHaveBeenLastCalledWith('closed', 'desktop_rfb_unavailable')
})
