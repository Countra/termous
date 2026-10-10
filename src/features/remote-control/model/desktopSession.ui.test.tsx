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
