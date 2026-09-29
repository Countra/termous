import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudGateway } from '#entities/cloud'
import { useCloudAccount } from './useCloudAccount'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function gateway() {
  return { subscribeStatus: () => () => {}, getStatus: () => undefined, status: vi.fn(async () => undefined) } as unknown as CloudGateway
}

test('切换 Core 后旧请求不会阻塞新操作或提前释放新操作的忙碌状态', async () => {
  const oldApi = gateway()
  const nextApi = gateway()
  const view = renderHook(({ api }) => useCloudAccount(api), { initialProps: { api: oldApi } })
  const old = deferred()
  let oldRun!: Promise<unknown>
  act(() => { oldRun = view.result.current.run(() => old.promise) })
  expect(view.result.current.busy).toBe(true)
  view.rerender({ api: nextApi })
  expect(view.result.current.busy).toBe(false)
  const current = deferred()
  const action = vi.fn(() => current.promise)
  let currentRun!: Promise<unknown>
  act(() => { currentRun = view.result.current.run(action) })
  expect(action).toHaveBeenCalledTimes(1)
  await act(async () => { old.resolve(); await oldRun })
  expect(view.result.current.busy).toBe(true)
  const duplicate = vi.fn(async () => undefined)
  await act(async () => { await view.result.current.run(duplicate) })
  expect(duplicate).not.toHaveBeenCalled()
  await act(async () => { current.resolve(); await currentRun })
  expect(view.result.current.busy).toBe(false)
  expect(view.result.current.error).toBeUndefined()
})
