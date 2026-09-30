import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudProfile, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { useCloudProfile } from './useCloudProfile'

const value = (id: string): CloudProfile => ({ user_id: id, name: id, bio: '', organization: '', avatar: '', revision: '0', updated_at: null })
const ready: CloudStatus = { revision: 1, generation: 'generation', configured: true, authenticated: true, user_id: 'current', phase: 'ready', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
function gateway(overrides: Partial<CloudGateway>) {
  const state = new CloudState()
  state.accept(ready)
  return { getStatus: state.snapshot, subscribeStatus: state.subscribe, acceptStatus: state.accept.bind(state), ...overrides } as CloudGateway
}
const reconnect = (api: CloudGateway) => {
  const status = api.getStatus()!
  api.acceptStatus({ ...status, revision: status.revision + 1, phase: 'blocked', error_code: 'network_unavailable' })
  api.acceptStatus({ ...status, revision: status.revision + 2, phase: 'syncing' })
  api.acceptStatus({ ...status, revision: status.revision + 3, phase: 'ready' })
}

test.each(['network_unavailable', 'service_unavailable', 'rate_limited', 'response_incomplete'])('首次资料读取暂时失败后在网络恢复事件中自动重试：%s', async (code) => {
  const api = gateway({ profile: vi.fn().mockRejectedValueOnce(new Error(code)).mockResolvedValue(value('current')) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.error).toBe(code))
  act(() => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(view.result.current.profile?.user_id).toBe('current'))
  expect(view.result.current.error).toBeUndefined()
  expect(api.profile).toHaveBeenCalledTimes(2)
})

test('没有网络事件时首次读取按指数退避重试，间隔最多一分钟', async () => {
  vi.useFakeTimers()
  const api = gateway({ profile: vi.fn(async () => { throw new Error('network_unavailable') }) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  try {
    await act(async () => { await Promise.resolve() })
    let calls = 1
    for (const delay of [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
      expect(api.profile).toHaveBeenCalledTimes(calls)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(api.profile).toHaveBeenCalledTimes(++calls)
    }
    vi.mocked(api.profile).mockResolvedValue(value('current'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(view.result.current.profile?.user_id).toBe('current')
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(api.profile).toHaveBeenCalledTimes(calls + 1)
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

test('资料写入断网后不自动重放写入或替换已有快照', async () => {
  const api = gateway({ profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => { throw new Error('network_unavailable') }) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  const snapshot = view.result.current.profile
  await act(async () => { expect(await view.result.current.save({ expected_revision: '0', name: 'Draft' })).toBeUndefined() })
  act(() => { window.dispatchEvent(new Event('online')) })
  expect(view.result.current.profile).toBe(snapshot)
  expect(api.profile).toHaveBeenCalledTimes(1)
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
})

test('离开账号后清理网络恢复监听，不再请求旧账号', async () => {
  const api = gateway({ profile: vi.fn(async () => { throw new Error('network_unavailable') }) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.error).toBe('network_unavailable'))
  view.unmount()
  act(() => { window.dispatchEvent(new Event('online')) })
  expect(api.profile).toHaveBeenCalledTimes(1)
})

test('切换账号时立即隔离资料，迟到读取不能覆盖当前账号', async () => {
  let resolve!: (value: CloudProfile) => void
  const api = gateway({ profile: vi.fn((generation: string) => generation === 'old' ? new Promise<CloudProfile>((done) => { resolve = done }) : Promise.resolve(value('new'))) })
  const view = renderHook(({ id }) => useCloudProfile(api, id, id), { initialProps: { id: 'old' } })
  await waitFor(() => expect(api.profile).toHaveBeenCalledWith('old', expect.any(AbortSignal)))
  view.rerender({ id: 'new' })
  await waitFor(() => expect(view.result.current.profile?.user_id).toBe('new'))
  await act(async () => { resolve(value('old')) })
  expect(view.result.current.profile?.name).toBe('new')
})

test('资料更新失败保留原快照且不自动重试', async () => {
  const api = gateway({ profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => { throw new Error('profile_conflict') }) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  await act(async () => { expect(await view.result.current.save({ expected_revision: '0', name: 'Draft' })).toBeUndefined() })
  expect(view.result.current.profile?.name).toBe('current')
  expect(view.result.current.error).toBe('profile_conflict')
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
})

test('旧页面保留的读写回调不能借用新连接的请求生命周期', async () => {
  const previous = gateway({ profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => value('current')) })
  const next = gateway({ profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => value('current')) })
  const view = renderHook(({ api }) => useCloudProfile(api, 'generation', 'current'), { initialProps: { api: previous } })
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  const stale = view.result.current
  view.rerender({ api: next })
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  await act(async () => {
    await stale.reload()
    expect(await stale.save({ expected_revision: '0', name: 'Old draft' })).toBeUndefined()
  })
  expect(previous.profile).toHaveBeenCalledTimes(1)
  expect(previous.updateProfile).not.toHaveBeenCalled()
  expect(view.result.current.profile?.name).toBe('current')
})

test('保存途中切换账号后，迟到的保存结果不能覆盖新账号或释放其请求锁', async () => {
  let finishSave!: (result: CloudProfile) => void
  let finishLoad!: (result: CloudProfile) => void
  const api = gateway({
    profile: vi.fn((generation: string) => generation === 'old' ? Promise.resolve(value('old')) : new Promise<CloudProfile>((done) => { finishLoad = done })),
    updateProfile: vi.fn(() => new Promise<CloudProfile>((done) => { finishSave = done })),
  })
  const view = renderHook(({ id }) => useCloudProfile(api, id, id), { initialProps: { id: 'old' } })
  await waitFor(() => expect(view.result.current.profile?.user_id).toBe('old'))
  let saving!: Promise<CloudProfile | undefined>
  act(() => { saving = view.result.current.save({ expected_revision: '0', name: 'Draft' }) })
  await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1))
  view.rerender({ id: 'new' })
  await act(async () => { finishSave({ ...value('old'), revision: '1' }); expect(await saving).toBeUndefined() })
  expect(view.result.current.profile).toBeUndefined()
  expect(view.result.current.loading).toBe(true)
  await act(async () => { expect(await view.result.current.save({ expected_revision: '0', name: 'New' })).toBeUndefined() })
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
  await act(async () => { finishLoad(value('new')) })
  expect(view.result.current.profile?.user_id).toBe('new')
})

test('Core 恢复事件立即刷新已有头像昵称，普通状态推送不重复请求', async () => {
  const next = { ...value('current'), name: '新昵称', avatar: 'new-avatar', revision: '1' }
  const api = gateway({ profile: vi.fn().mockResolvedValueOnce(value('current')).mockResolvedValue(next) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.profile?.revision).toBe('0'))
  act(() => { reconnect(api) })
  await waitFor(() => expect(view.result.current.profile).toEqual(next))
  act(() => { api.acceptStatus({ ...ready, revision: 5 }) })
  expect(api.profile).toHaveBeenCalledTimes(2)
})

test('首次离线时仅 Core 恢复即可补齐资料，不必等浏览器事件或退避定时器', async () => {
  const api = gateway({ profile: vi.fn().mockRejectedValueOnce(new Error('network_unavailable')).mockResolvedValue(value('current')) })
  api.acceptStatus({ ...ready, revision: 2, phase: 'blocked', error_code: 'network_unavailable' })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.error).toBe('network_unavailable'))
  act(() => { api.acceptStatus({ ...ready, revision: 3 }) })
  await waitFor(() => expect(view.result.current.profile?.name).toBe('current'))
  expect(api.profile).toHaveBeenCalledTimes(2)
})

test('重连立即取消旧读取并获取最新资料，不等待旧请求超时', async () => {
  let finish!: (result: CloudProfile) => void
  const api = gateway({ profile: vi.fn().mockImplementationOnce(() => new Promise<CloudProfile>((done) => { finish = done })).mockResolvedValue({ ...value('current'), revision: '2' }) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(1))
  const previousSignal = vi.mocked(api.profile).mock.calls[0][1]!
  act(() => { reconnect(api) })
  await waitFor(() => expect(view.result.current.profile?.revision).toBe('2'))
  expect(previousSignal.aborted).toBe(true)
  expect(api.profile).toHaveBeenCalledTimes(2)
  await act(async () => { finish(value('current')) })
  expect(view.result.current.profile?.revision).toBe('2')
})

test('手动重新载入等待已有读取结果，避免确认丢弃草稿后没有可用快照', async () => {
  let finish!: (result: CloudProfile) => void
  const next = { ...value('current'), revision: '2' }
  const api = gateway({ profile: vi.fn(() => new Promise<CloudProfile>((done) => { finish = done })) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(1))
  let reload!: Promise<CloudProfile | undefined>
  act(() => { reload = view.result.current.reload() })
  await act(async () => { finish(next); expect(await reload).toEqual(next) })
  expect(api.profile).toHaveBeenCalledTimes(1)
})

test('保存失败前收到恢复事件会补读，但保留保存失败且不重放写入', async () => {
  let fail!: (cause: Error) => void
  const api = gateway({ profile: vi.fn(async () => value('current')), updateProfile: vi.fn(() => new Promise<CloudProfile>((_, reject) => { fail = reject })) })
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  let saving!: Promise<CloudProfile | undefined>
  act(() => { saving = view.result.current.save({ expected_revision: '0', name: 'Draft' }) })
  await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1))
  act(() => { reconnect(api) })
  expect(api.profile).toHaveBeenCalledTimes(1)
  await act(async () => { fail(new Error('network_unavailable')); await saving })
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2))
  expect(view.result.current.error).toBe('network_unavailable')
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
})

test('替换网关后旧订阅不能触发当前账号刷新', async () => {
  const previous = gateway({ profile: vi.fn(async () => value('current')) })
  const next = gateway({ profile: vi.fn(async () => value('current')) })
  const view = renderHook(({ api }) => useCloudProfile(api, 'generation', 'current'), { initialProps: { api: previous } })
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  view.rerender({ api: next })
  await waitFor(() => expect(next.profile).toHaveBeenCalledTimes(1))
  act(() => { reconnect(previous) })
  expect(previous.profile).toHaveBeenCalledTimes(1)
  expect(next.profile).toHaveBeenCalledTimes(1)
  act(() => { reconnect(next) })
  await waitFor(() => expect(next.profile).toHaveBeenCalledTimes(2))
})
