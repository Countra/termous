import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudAuthorization, CloudSecurityOverview } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
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
    getStatus: vi.fn(() => ({ generation })), subscribeStatus: vi.fn<CloudGateway['subscribeStatus']>(() => () => {}), subscribeChanges: vi.fn<CloudGateway['subscribeChanges']>(() => () => {}),
    security: vi.fn<CloudGateway['security']>(async () => overview('1')), deviceRequests: vi.fn<CloudGateway['deviceRequests']>(async () => []), recoveryOperations: vi.fn<CloudGateway['recoveryOperations']>(async () => []),
  }
}

test('安全上下文的多次刷新合并补读，待办不等待上下文且旧快照不能覆盖操作', async () => {
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
  expect(view.result.current.loading).toBe(false)
  await act(async () => { latest.resolve(overview('2')) })
  expect(view.result.current.security?.recovery.policy.revision).toBe('2')
  expect(view.result.current.loading).toBe(false)
  expect(api.deviceRequests).toHaveBeenCalledTimes(3)
})

test('安全及恢复读取挂起时，新申请仍独立立即补读并显示', async () => {
  const security = deferred<CloudSecurityOverview>(), recovery = deferred<CloudAuthorization[]>()
  const request: CloudAuthorization = { server_time: new Date().toISOString(),
    id: 'new-request', workspace_id: 'workspace', device_id: 'new-device', kind: 'approval', remaining_ms: 600_000, status: 'pending', revision: '1',
    name: 'Synthetic Device', platform: 'Windows', source_summary: '', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(),
    target_confirmed: false, keys_verified: false, allowed_actions: ['approve'],
  }
  const api = gateway()
  api.security.mockImplementation(() => security.promise)
  api.recoveryOperations.mockImplementation(() => recovery.promise)
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  api.deviceRequests.mockResolvedValue([request])
  await act(async () => { await view.result.current.reload() })
  expect(view.result.current.requests).toEqual([request])
  expect(view.result.current.security).toBeUndefined()
  expect(api.deviceRequests).toHaveBeenCalledTimes(2)
  view.unmount()
  await act(async () => { security.resolve(overview('1')); recovery.resolve([]) })
})

test('申请读取期间的重复提示合并为一次补读，旧申请快照不覆盖新结果', async () => {
  const first = deferred<CloudAuthorization[]>(), latest = deferred<CloudAuthorization[]>()
  const api = gateway()
  api.deviceRequests.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise)
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(api.deviceRequests).toHaveBeenCalledTimes(1))
  await act(async () => { await view.result.current.reload(); await view.result.current.reload() })
  await act(async () => { first.resolve([]) })
  await waitFor(() => expect(api.deviceRequests).toHaveBeenCalledTimes(2))
  expect(view.result.current.loading).toBe(true)
  await act(async () => { latest.resolve([]) })
  expect(view.result.current.loading).toBe(false)
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

test('等待申请列表不固定轮询，事件到达立即补读新申请', async () => {
  const state = new CloudState()
  state.accept({ generation: 'current', revision: 1, configured: true, authenticated: true, phase: 'ready', auto_sync: false, confirmed: false, pending: 0, conflicts: 0 })
  const api = gateway()
  api.getStatus.mockImplementation(() => state.snapshot()!)
  api.subscribeStatus.mockImplementation(state.subscribe)
  api.subscribeChanges.mockImplementation(state.subscribeChanges)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
    await act(async () => { await Promise.resolve() })
    expect(api.deviceRequests).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(api.deviceRequests).toHaveBeenCalledTimes(1)
    const value: CloudAuthorization = { server_time: new Date().toISOString(), id: 'new-request', workspace_id: 'workspace', device_id: 'new-device', kind: 'approval', remaining_ms: 600_000, status: 'pending', revision: '1', name: 'New device', platform: 'Windows', source_summary: '', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(), target_confirmed: false, keys_verified: false, allowed_actions: ['approve'] }
    api.deviceRequests.mockResolvedValue([value])
    await act(async () => { state.acceptEvent({ type: 'account', status: state.snapshot()!, changes: ['authorizations'], operations: [value.id] }) })
    expect(view.result.current.requests).toEqual([value])
    expect(api.deviceRequests).toHaveBeenCalledTimes(2)
    view.unmount()
  } finally { vi.useRealTimers() }
})

test('安全上下文重新读取失败时不继续把旧 MFA 状态当作当前证明', async () => {
  const api = gateway()
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(view.result.current.security?.account.mfa_enabled).toBe(true))
  api.security.mockRejectedValueOnce(new Error('network_unavailable'))
  await act(async () => { await view.result.current.reload() })
  expect(view.result.current.security).toBeUndefined()
  expect(view.result.current.error).toBe(true)
})

test('在途读取遇到连续 WS 提示仍立即展示当前申请，再合并补读最新状态', async () => {
  const first = deferred<CloudAuthorization[]>(), latest = deferred<CloudAuthorization[]>()
  const firstSecurity = deferred<CloudSecurityOverview>(), latestSecurity = deferred<CloudSecurityOverview>()
  const api = gateway()
  api.deviceRequests.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise)
  api.security.mockImplementationOnce(() => firstSecurity.promise).mockImplementationOnce(() => latestSecurity.promise)
  let notify!: Parameters<CloudGateway['subscribeChanges']>[0]
  api.subscribeChanges.mockImplementation(listener => { notify = listener; return () => {} })
  const value: CloudAuthorization = { server_time: new Date().toISOString(), id: 'burst-first', workspace_id: 'workspace', device_id: 'new-device', kind: 'approval', remaining_ms: 600_000, status: 'pending', revision: '1', name: 'First request', platform: 'Windows', source_summary: '', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(), target_confirmed: false, keys_verified: false, allowed_actions: ['approve'] }
  const view = renderHook(() => useCloudAuthorization(api as unknown as CloudGateway, 'current'))
  await waitFor(() => expect(api.deviceRequests).toHaveBeenCalledTimes(1))
  await act(async () => { for (let i = 0; i < 20; i++) notify({ generation: 'current', changes: ['authorizations'], operations: [value.id] }) })
  expect(api.deviceRequests).toHaveBeenCalledTimes(1)
  await act(async () => { first.resolve([value]); firstSecurity.resolve(overview('1')) })
  expect(view.result.current.requests).toEqual([value])
  expect(view.result.current.loading).toBe(false)
  expect(view.result.current.security?.recovery.policy.revision).toBe('1')
  expect(api.deviceRequests).toHaveBeenCalledTimes(2)
  expect(api.security).toHaveBeenCalledTimes(2)
  await act(async () => { latest.resolve([{ ...value, revision: '2', status: 'verifying' }]); latestSecurity.resolve(overview('2')) })
  expect(view.result.current.requests[0].revision).toBe('2')
  expect(view.result.current.security?.recovery.policy.revision).toBe('2')
})
