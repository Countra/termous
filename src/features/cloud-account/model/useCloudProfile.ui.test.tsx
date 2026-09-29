import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudProfile } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudProfile } from './useCloudProfile'

const value = (id: string): CloudProfile => ({ user_id: id, name: id, bio: '', organization: '', avatar: '', revision: '0', updated_at: null })

test('切换账号时立即隔离资料，迟到读取不能覆盖当前账号', async () => {
  let resolve!: (value: CloudProfile) => void
  const api = { profile: vi.fn((generation: string) => generation === 'old' ? new Promise<CloudProfile>((done) => { resolve = done }) : Promise.resolve(value('new'))) } as unknown as CloudGateway
  const view = renderHook(({ id }) => useCloudProfile(api, id, id), { initialProps: { id: 'old' } })
  view.rerender({ id: 'new' })
  await waitFor(() => expect(view.result.current.profile?.user_id).toBe('new'))
  await act(async () => { resolve(value('old')) })
  expect(view.result.current.profile?.name).toBe('new')
})

test('资料更新失败保留原快照且不自动重试', async () => {
  const api = { profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => { throw new Error('profile_conflict') }) } as unknown as CloudGateway
  const view = renderHook(() => useCloudProfile(api, 'generation', 'current'))
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  await act(async () => { expect(await view.result.current.save({ expected_revision: '0', name: 'Draft' })).toBe(false) })
  expect(view.result.current.profile?.name).toBe('current')
  expect(view.result.current.error).toBe('profile_conflict')
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
})

test('旧页面保留的读写回调不能借用新连接的请求生命周期', async () => {
  const previous = { profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => value('current')) } as unknown as CloudGateway
  const next = { profile: vi.fn(async () => value('current')), updateProfile: vi.fn(async () => value('current')) } as unknown as CloudGateway
  const view = renderHook(({ api }) => useCloudProfile(api, 'generation', 'current'), { initialProps: { api: previous } })
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  const stale = view.result.current
  view.rerender({ api: next })
  await waitFor(() => expect(view.result.current.profile).toBeDefined())
  await act(async () => {
    await stale.reload()
    expect(await stale.save({ expected_revision: '0', name: 'Old draft' })).toBe(false)
  })
  expect(previous.profile).toHaveBeenCalledTimes(1)
  expect(previous.updateProfile).not.toHaveBeenCalled()
  expect(view.result.current.profile?.name).toBe('current')
})

test('保存途中切换账号后，迟到的保存结果不能覆盖新账号或释放其请求锁', async () => {
  let finishSave!: (result: CloudProfile) => void
  let finishLoad!: (result: CloudProfile) => void
  const api = {
    profile: vi.fn((generation: string) => generation === 'old' ? Promise.resolve(value('old')) : new Promise<CloudProfile>((done) => { finishLoad = done })),
    updateProfile: vi.fn(() => new Promise<CloudProfile>((done) => { finishSave = done })),
  } as unknown as CloudGateway
  const view = renderHook(({ id }) => useCloudProfile(api, id, id), { initialProps: { id: 'old' } })
  await waitFor(() => expect(view.result.current.profile?.user_id).toBe('old'))
  let saving!: Promise<boolean>
  act(() => { saving = view.result.current.save({ expected_revision: '0', name: 'Draft' }) })
  view.rerender({ id: 'new' })
  await act(async () => { finishSave({ ...value('old'), revision: '1' }); expect(await saving).toBe(false) })
  expect(view.result.current.profile).toBeUndefined()
  expect(view.result.current.loading).toBe(true)
  await act(async () => { expect(await view.result.current.save({ expected_revision: '0', name: 'New' })).toBe(false) })
  expect(api.updateProfile).toHaveBeenCalledTimes(1)
  await act(async () => { finishLoad(value('new')) })
  expect(view.result.current.profile?.user_id).toBe('new')
})
