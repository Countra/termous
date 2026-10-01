import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudSecurityOverview } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudAuthorization } from './useCloudAuthorization'

function overview(revision: string): CloudSecurityOverview {
  return {
    account: { contract: 'cloud-authorization-v1', managed_recovery: true, mfa_enabled: true, mfa_revision: '1' },
    recovery: { policy: { workspace_id: 'workspace', revision, status: 'disabled', updated_at: new Date().toISOString() }, available: false },
    membership_initialized: true, keys_verified: true,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function gateway(generation = 'current') {
  return {
    getStatus: vi.fn(() => ({ generation })), subscribeStatus: vi.fn(() => () => {}),
    security: vi.fn<CloudGateway['security']>(async () => overview('1')), deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []),
  }
}

test('读取期间的多次刷新合并补读，旧快照不能覆盖刚完成的操作', async () => {
  const first = deferred<CloudSecurityOverview>(), latest = deferred<CloudSecurityOverview>()
  const api = gateway()
  api.security.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise)
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(api.security).toHaveBeenCalledTimes(1))
  await act(async () => { await view.result.current.reload(); await view.result.current.reload() })
  expect(api.security).toHaveBeenCalledTimes(1)
  await act(async () => { first.resolve(overview('1')) })
  await waitFor(() => expect(api.security).toHaveBeenCalledTimes(2))
  expect(view.result.current.security).toBeUndefined()
  expect(view.result.current.loading).toBe(true)
  await act(async () => { latest.resolve(overview('2')) })
  expect(view.result.current.security?.recovery.policy.revision).toBe('2')
  expect(view.result.current.loading).toBe(false)
  expect(api.deviceRequests).toHaveBeenCalledTimes(2)
})

test('已被刷新提示作废的读取错误不覆盖补读状态', async () => {
  const first = deferred<CloudSecurityOverview>(), latest = deferred<CloudSecurityOverview>()
  const api = gateway()
  api.security.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise)
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(api.security).toHaveBeenCalledTimes(1))
  await act(async () => { await view.result.current.reload(); first.reject(new Error('network_unavailable')) })
  await waitFor(() => expect(api.security).toHaveBeenCalledTimes(2))
  expect(view.result.current.error).toBe(false)
  await act(async () => { latest.resolve(overview('2')) })
  expect(view.result.current.security?.recovery.policy.revision).toBe('2')
})

test('切换账号后取消旧补读，保留的旧回调不能访问新账号', async () => {
  const old = deferred<CloudSecurityOverview>()
  const api = gateway('old')
  api.security.mockImplementationOnce(() => old.promise).mockResolvedValue(overview('2'))
  const view = renderHook(({ generation }) => useCloudAuthorization(api as unknown as CloudGateway, generation), { initialProps: { generation: 'old' } })
  await waitFor(() => expect(api.security).toHaveBeenCalledTimes(1))
  const stale = view.result.current.reload
  await act(async () => { await stale() })
  api.getStatus.mockReturnValue({ generation: 'new' })
  view.rerender({ generation: 'new' })
  await waitFor(() => expect(view.result.current.security?.recovery.policy.revision).toBe('2'))
  await act(async () => { old.resolve(overview('0')); await stale() })
  expect(api.security).toHaveBeenCalledTimes(2)
  expect(vi.mocked(api.security).mock.calls[0][1]?.aborted).toBe(true)
  expect(view.result.current.security?.recovery.policy.revision).toBe('2')
})

test('更换 Core 网关后旧回调不能借用新请求生命周期', async () => {
  const previous = gateway(), next = gateway()
  const view = renderHook(({ api }) => useCloudAuthorization(api as unknown as CloudGateway, 'current'), { initialProps: { api: previous } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const stale = view.result.current.reload
  view.rerender({ api: next })
  await waitFor(() => expect(next.security).toHaveBeenCalledTimes(1))
  await act(async () => { await stale() })
  expect(previous.security).toHaveBeenCalledTimes(1)
  expect(next.security).toHaveBeenCalledTimes(1)
})
