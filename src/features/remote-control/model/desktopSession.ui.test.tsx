import { create } from '@bufbuild/protobuf'
import { RemoteDesktopSession, type DesktopSessionEvents } from '@termous/remote-protocol/desktop'
import { DesktopResponseSchema, type DesktopResponse } from '@termous/remote-protocol/desktop-protocol'
import { expect, test, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('关闭等待迟到的附着及撤销完成，且不会继续协商媒体', async () => {
  const attached = deferred<DesktopResponse>()
  const detached = deferred<DesktopResponse>()
  const request = vi.fn().mockReturnValueOnce(attached.promise).mockReturnValueOnce(detached.promise)
  const ice = vi.fn()
  const events: DesktopSessionEvents = { state: vi.fn(), status: vi.fn(), clipboard: vi.fn(), challenge: vi.fn() }
  const runtime = new RemoteDesktopSession({ request, ice }, 'desktop', 1n, events)
  const starting = runtime.start(document.createElement('div'), document.createElement('video'))
  let closed = false
  const closing = runtime.close().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  attached.resolve(create(DesktopResponseSchema, { attachment: { id: 'attachment', mediaGeneration: 2n, transport: 'h264' } }))
  await starting
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request.mock.calls[1][0]).toMatchObject({ action: 'detach', attachmentId: 'attachment', mediaGeneration: 2n })
  expect(closed).toBe(false)
  detached.resolve(create(DesktopResponseSchema))
  await closing
  expect(closed).toBe(true)
  expect(ice).not.toHaveBeenCalled()
})

test('关闭期间附着失败也能完成回收，已关闭实例不会再次申请席位', async () => {
  const attached = deferred<DesktopResponse>()
  const request = vi.fn().mockReturnValue(attached.promise)
  const runtime = new RemoteDesktopSession({ request, ice: vi.fn() }, 'desktop', 1n, { state: vi.fn(), status: vi.fn(), clipboard: vi.fn(), challenge: vi.fn() })
  const target = document.createElement('div'), video = document.createElement('video')
  const starting = runtime.start(target, video)
  const closing = runtime.close()
  attached.reject(new Error('desktop_control_locked'))
  await Promise.all([starting, closing])
  await runtime.start(target, video)
  expect(request).toHaveBeenCalledTimes(1)
})

test.each([
  ['remote_disconnected', 'remote_disconnected'],
  ['failed to fetch turn:private.invalid credential=synthetic', 'desktop_ice_unavailable'],
])('ICE 获取失败仅报告安全错误码并释放一次附着: %s', async (message, expected) => {
  const request = vi.fn()
    .mockResolvedValueOnce(create(DesktopResponseSchema, { attachment: { id: 'attachment', mediaGeneration: 2n, transport: 'h264' } }))
    .mockResolvedValueOnce(create(DesktopResponseSchema, { state: { available: true } }))
    .mockResolvedValue(create(DesktopResponseSchema))
  const events: DesktopSessionEvents = { state: vi.fn(), status: vi.fn(), clipboard: vi.fn(), challenge: vi.fn() }
  const runtime = new RemoteDesktopSession({ request, ice: vi.fn().mockRejectedValue(new Error(message)) }, 'desktop', 1n, events)
  await runtime.start(document.createElement('div'), document.createElement('video'))
  await runtime.close()
  expect(events.status).toHaveBeenLastCalledWith('closed', expected)
  expect(request.mock.calls.map(([value]) => value.action)).toEqual(['attach', 'describe', 'detach'])
})

test.each([
  ['certificate-a', 'fingerprint-a', 1],
  ['certificate-b', 'fingerprint-a', 2],
  ['certificate-a', 'fingerprint-b', 2],
])('确认后旧快照不重复弹窗，新挑战仍需确认：%s / %s', async (id, fingerprint, count) => {
  vi.useFakeTimers()
  let descriptions = 0
  const request = vi.fn(async (input: { action?: string }) => {
    if (input.action === 'attach') return create(DesktopResponseSchema, { attachment: { id: 'attachment', mediaGeneration: 1n, transport: 'h264' } })
    if (input.action === 'describe') {
      descriptions++
      if (descriptions <= 2) return create(DesktopResponseSchema, { state: { targetState: 'waiting_host_trust' }, challenge: { kind: 'certificate', id: descriptions === 1 ? 'certificate-a' : id, fingerprint: descriptions === 1 ? 'fingerprint-a' : fingerprint } })
      return create(DesktopResponseSchema, { state: { available: true } })
    }
    return create(DesktopResponseSchema)
  })
  const challenge = vi.fn().mockResolvedValue({ accept: true })
  const ice = vi.fn().mockRejectedValue(new Error('desktop_ice_unavailable'))
  const runtime = new RemoteDesktopSession({ request, ice }, 'session', 1n, { state: vi.fn(), status: vi.fn(), clipboard: vi.fn(), challenge })
  try {
    const starting = runtime.start(document.createElement('div'), document.createElement('video'))
    await vi.advanceTimersByTimeAsync(1_000)
    await starting
    expect(challenge).toHaveBeenCalledTimes(count)
    expect(request.mock.calls.filter(([input]) => input.action === 'challenge')).toHaveLength(count)
    expect(ice).toHaveBeenCalledTimes(1)
  } finally { await runtime.close(); vi.useRealTimers() }
})
