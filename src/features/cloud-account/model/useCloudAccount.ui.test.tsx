import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudGateway } from '#entities/cloud'
import { CloudState } from '#entities/cloud'
import type { CloudStatus } from '#common/contracts'
import { useCloudAccount } from './useCloudAccount'

function deferred() {
  let resolve!: () => void
  let reject!: (cause: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function gateway() {
  return { subscribeStatus: () => () => {}, getStatus: () => undefined, status: vi.fn(async () => undefined) } as unknown as CloudGateway
}

test('恢复连接和刷新状态都不能清除失败操作的反馈，也不重放操作', async () => {
  const state = new CloudState()
  const initial: CloudStatus = { revision: 1, generation: 'current', configured: true, authenticated: true, phase: 'ready', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  state.accept(initial)
  const api = { subscribeStatus: state.subscribe, getStatus: state.snapshot, status: vi.fn(async () => state.snapshot()!) } as unknown as CloudGateway
  const view = renderHook(() => useCloudAccount(api))
  const action = vi.fn(async () => {
    state.accept({ ...initial, revision: 2, phase: 'blocked', error_code: 'network_unavailable' })
    throw new Error('network_unavailable')
  })
  await act(async () => { await view.result.current.run(action) })
  expect(view.result.current.error).toBe('network_unavailable')
  act(() => { state.accept({ ...initial, revision: 3 }) })
  await act(async () => { await view.result.current.refresh() })
  expect(view.result.current.error).toBe('network_unavailable')
  expect(action).toHaveBeenCalledTimes(1)
  await act(async () => { await view.result.current.run(async () => { throw new Error('profile_conflict') }) })
  act(() => { state.accept({ ...initial, revision: 4 }) })
  expect(view.result.current.error).toBe('profile_conflict')
  await act(async () => { await view.result.current.run(async () => undefined) })
  expect(view.result.current.error).toBeUndefined()
})

test('权威状态恢复后清除状态读取错误', async () => {
  const state = new CloudState()
  const initial: CloudStatus = { revision: 1, generation: 'current', configured: true, authenticated: true, phase: 'blocked', error_code: 'network_unavailable', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  state.accept(initial)
  const api = { subscribeStatus: state.subscribe, getStatus: state.snapshot, status: vi.fn(async () => { throw new Error('network_unavailable') }) } as unknown as CloudGateway
  const view = renderHook(() => useCloudAccount(api))
  await waitFor(() => expect(view.result.current.error).toBe('network_unavailable'))
  act(() => { state.accept({ ...initial, revision: 2, phase: 'ready', error_code: undefined }) })
  await waitFor(() => expect(view.result.current.error).toBeUndefined())
})

test('切换 Core 后再调用保留的旧回调，不访问旧连接也不影响新操作', async () => {
  const oldApi = gateway()
  const nextApi = gateway()
  const view = renderHook(({ api }) => useCloudAccount(api), { initialProps: { api: oldApi } })
  await act(async () => { await Promise.resolve() })
  const stale = view.result.current
  view.rerender({ api: nextApi })
  const action = vi.fn(async () => undefined)
  await act(async () => { await stale.refresh(); await stale.run(action) })
  expect(oldApi.status).toHaveBeenCalledTimes(1)
  expect(action).not.toHaveBeenCalled()
  expect(view.result.current.busy).toBe(false)
  expect(view.result.current.error).toBeUndefined()
  await act(async () => { await view.result.current.run(action) })
  expect(action).toHaveBeenCalledTimes(1)
})

test('切换账号后拒绝旧回调，并隔离迟到错误', async () => {
  const state = new CloudState()
  const initial: CloudStatus = { revision: 1, generation: 'old', configured: true, authenticated: true, phase: 'ready', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  state.accept(initial)
  const api = { subscribeStatus: state.subscribe, getStatus: state.snapshot, status: vi.fn(async () => state.snapshot()!) } as unknown as CloudGateway
  const view = renderHook(() => useCloudAccount(api))
  const stale = view.result.current
  const old = deferred()
  let oldRun!: Promise<unknown>
  act(() => { oldRun = stale.run(async () => { await old.promise; throw new Error('network_unavailable') }) })
  act(() => { state.accept({ ...initial, generation: 'new' }) })
  await act(async () => { old.resolve(); await oldRun })
  const action = vi.fn(async () => undefined)
  await act(async () => { await stale.run(action) })
  expect(action).not.toHaveBeenCalled()
  expect(view.result.current.error).toBeUndefined()
  expect(view.result.current.busy).toBe(false)
})

test('正常登录改变账号代次后仍完成操作并释放忙碌状态', async () => {
  const state = new CloudState()
  const initial: CloudStatus = { revision: 1, generation: 'before', configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  state.accept(initial)
  const api = { subscribeStatus: state.subscribe, getStatus: state.snapshot, status: vi.fn(async () => state.snapshot()!) } as unknown as CloudGateway
  const view = renderHook(() => useCloudAccount(api))
  await act(async () => {
    expect(await view.result.current.run(async () => {
      state.accept({ ...initial, generation: 'after', authenticated: true, phase: 'ready' })
      return 'logged-in'
    })).toBe('logged-in')
  })
  expect(view.result.current.busy).toBe(false)
  expect(view.result.current.error).toBeUndefined()
})

test('切换账号后迟到的状态读取错误不污染当前账号', async () => {
  const state = new CloudState()
  const initial: CloudStatus = { revision: 1, generation: 'old', configured: true, authenticated: true, phase: 'ready', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
  state.accept(initial)
  const read = deferred()
  const api = { subscribeStatus: state.subscribe, getStatus: state.snapshot, status: vi.fn(async () => state.snapshot()!) } as unknown as CloudGateway
  const view = renderHook(() => useCloudAccount(api))
  await act(async () => { await Promise.resolve() })
  vi.mocked(api.status).mockImplementationOnce(async () => { await read.promise; return state.snapshot()! })
  let reading!: Promise<void>
  act(() => { reading = view.result.current.refresh() })
  act(() => { state.accept({ ...initial, generation: 'new', authenticated: false, phase: 'signed_out' }) })
  await act(async () => { read.reject(new Error('network_unavailable')); await reading })
  expect(view.result.current.error).toBeUndefined()
})

test('较新的状态读取成功后，迟到的旧读取失败不恢复错误提示', async () => {
  const api = gateway()
  const view = renderHook(() => useCloudAccount(api))
  await act(async () => { await Promise.resolve() })
  const read = deferred()
  vi.mocked(api.status).mockImplementationOnce(async () => { await read.promise; return undefined as unknown as CloudStatus })
  let reading!: Promise<void>
  act(() => { reading = view.result.current.refresh() })
  await act(async () => { await view.result.current.refresh() })
  await act(async () => { read.reject(new Error('local_failed')); await reading })
  expect(view.result.current.error).toBeUndefined()
})

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
