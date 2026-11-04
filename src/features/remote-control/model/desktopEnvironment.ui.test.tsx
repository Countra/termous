import { create } from '@bufbuild/protobuf'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DesktopAttachmentSchema, DesktopEnvironmentSchema } from '@termous/remote-protocol/desktop-protocol'
import { DesktopEnvironmentSwitch } from '../../../../../termous-remote/browser/desktop/environment'
import { DesktopTransition } from '../../../../../termous-remote/browser/desktop/transition'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const attachment = create(DesktopAttachmentSchema, { id: 'view', attachmentGeneration: 4n, mediaGeneration: 1n })
const value = (generation: bigint, revision: bigint, phase = 'preparing') => create(DesktopEnvironmentSchema, {
  attachment: { ...attachment, mediaGeneration: generation }, revision, switchId: generation, phase, remainingMs: 20_000n,
})

test('乱序通知、重复状态和旧确认不能推进当前媒体', async () => {
  const failed = vi.fn(), suspend = vi.fn(), signals: AbortSignal[] = []
  const connect = vi.fn(async (_value, signal: AbortSignal) => { signals.push(signal) })
  const c = new DesktopEnvironmentSwitch(attachment, { query: async () => value(1n, 1n), suspend, connect, failed })
  c.accept(value(1n, 1n)); await Promise.resolve()
  c.accept(value(2n, 2n)); await Promise.resolve()
  c.accept(value(1n, 3n)); c.accept(value(2n, 2n))
  expect(connect).toHaveBeenCalledTimes(2)
  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)
  c.confirmed(1n)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(failed).toHaveBeenCalledWith('desktop_environment_switch_timeout')
  c.close()
})

test('快速切换不重新计时，稳定窗口暂停不超时', async () => {
  const failed = vi.fn()
  const c = new DesktopEnvironmentSwitch(attachment, { query: async () => value(1n, 1n), suspend: vi.fn(), connect: async () => {}, failed })
  c.accept(value(1n, 1n)); c.confirmed(1n)
  c.accept(value(2n, 2n)); await vi.advanceTimersByTimeAsync(15_000)
  c.accept(value(3n, 3n)); await vi.advanceTimersByTimeAsync(5_000)
  expect(failed).toHaveBeenCalledTimes(1)
  c.close()
  const paused = new DesktopEnvironmentSwitch(attachment, { query: async () => value(1n, 1n), suspend: vi.fn(), connect: async () => {}, failed })
  paused.accept(value(1n, 1n, 'paused'))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(failed).toHaveBeenCalledTimes(1)
  paused.accept(value(2n, 2n)); paused.confirmed(2n)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(failed).toHaveBeenCalledTimes(1)
  paused.close()
})

test('切换快照最多保留一秒，重复切换不延长且不编码图片', async () => {
  const video = document.createElement('video'), root = document.createElement('div')
  root.append(video)
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } })
  const drawing = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
  const transition = new DesktopTransition(video)
  try {
    transition.begin(); expect(root.querySelectorAll('canvas')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(800); transition.begin()
    await vi.advanceTimersByTimeAsync(200)
    expect(root.querySelectorAll('canvas')).toHaveLength(0)
    expect(video.style.visibility).toBe('hidden')
    expect(encode).not.toHaveBeenCalled()
    transition.finish(); expect(video.style.visibility).toBe('')
  } finally { transition.close(); drawing.mockRestore(); encode.mockRestore() }
})

test('暂停在旧媒体销毁前执行，窗口稳定暂停取消正在准备的 Peer', async () => {
  const order: string[] = []
  const c = new DesktopEnvironmentSwitch(attachment, {
    query: async () => value(1n, 1n), failed: vi.fn(),
    suspend: () => order.push('snapshot-and-disable-input'),
    connect: async (_, signal) => { signal.addEventListener('abort', () => order.push('close-peer')) },
  })
  c.accept(value(1n, 1n)); await Promise.resolve()
  order.length = 0
  c.accept(value(2n, 2n, 'switching')); await Promise.resolve()
  expect(order).toEqual(['snapshot-and-disable-input', 'close-peer'])
  order.length = 0
  c.accept(value(2n, 3n, 'paused')); await Promise.resolve()
  expect(order).toEqual(['snapshot-and-disable-input', 'close-peer'])
  c.close()
})

test.each(['remote_request_timeout', 'desktop_stale', 'remote_connection_closed'])(
  '新快照已到达时，旧查询失败 %s 按实际故障边界处理', async code => {
    let reject!: (error: Error) => void
    const failed = vi.fn()
    const c = new DesktopEnvironmentSwitch(attachment, {
      query: () => new Promise((_, fail) => { reject = fail }),
      suspend: vi.fn(), connect: async () => {}, failed,
    })
    try {
      c.accept(value(1n, 1n)); c.confirmed(1n)
      const pending = c.refresh()
      c.accept(value(2n, 2n)); c.confirmed(2n)
      reject(new Error(code)); await pending
      expect(failed).toHaveBeenCalledTimes(code === 'remote_connection_closed' ? 1 : 0)
    } finally { c.close() }
  },
)

test('没有更新快照时，查询超时不能被忽略', async () => {
  const failed = vi.fn()
  const c = new DesktopEnvironmentSwitch(attachment, {
    query: async () => { throw new Error('remote_request_timeout') },
    suspend: vi.fn(), connect: async () => {}, failed,
  })
  try { await c.refresh(); expect(failed).toHaveBeenCalledTimes(1) }
  finally { c.close() }
})
