import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DockerResourceKind, DockerResourceList, DockerResourceActionResult } from '#entities/docker'
import type { DockerGateway, DockerSessionContext } from './contracts'
import { useDockerResources } from './useDockerResources'

const session: DockerSessionContext = { id: 'ssh-a', kind: 'ssh', status: 'connected' }
const list: DockerResourceList = { items: [], total: 0, filtered: 0, offset: 0, limit: 100, collected_at: '' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const api = {
    sessionDockerCapability: vi.fn(async () => ({ available: true, status: 'available', collected_at: '' })),
    sessionDockerResources: vi.fn<DockerGateway['sessionDockerResources']>(async () => list),
    sessionDockerResourceDetail: vi.fn<DockerGateway['sessionDockerResourceDetail']>(),
    sessionDockerResourceAction: vi.fn<DockerGateway['sessionDockerResourceAction']>(),
    sessionDockerResourceCreate: vi.fn<DockerGateway['sessionDockerResourceCreate']>(),
  }
  const onContainersChanged = vi.fn()
  const view = renderHook(({ current, kind, enabled, source = api, revision = 0 }) => useDockerResources(source as unknown as DockerGateway, current, kind, enabled, revision, onContainersChanged), {
    initialProps: { current: session, kind: 'volumes' as DockerResourceKind, enabled: true, source: api, revision: 0 },
  })
  const rerender = (props: { current: DockerSessionContext; kind: DockerResourceKind; enabled: boolean; source?: typeof api; revision?: number }) => view.rerender({ source: api, revision: 0, ...props })
  return { ...view, rerender, api, onContainersChanged }
}

test('切换 SSH 会话时取消读取，即使旧请求仍返回也不覆盖当前列表', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<DockerResourceList>()
  view.api.sessionDockerResources.mockReturnValueOnce(pending.promise)
  let refresh!: Promise<void>
  act(() => { refresh = view.result.current.refresh() })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2))
  const signal = view.api.sessionDockerResources.mock.calls[1][3]?.signal
  view.rerender({ current: { ...session, id: 'ssh-b' }, kind: 'volumes', enabled: true })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3))
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.resolve({ ...list, items: [{ kind: 'volumes', id: 'old', name: 'old' }] }); await refresh })
  expect(view.result.current.list?.items).toEqual([])
})

test('模式切换仍保留写操作防重，其他资源模式可独立读取', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<DockerResourceActionResult>()
  view.api.sessionDockerResourceAction.mockReturnValue(pending.promise)
  let action!: Promise<boolean>
  act(() => { action = view.result.current.action('data', { action: 'remove' }) })
  view.rerender({ current: session, kind: 'networks', enabled: true })
  expect(view.result.current.busy).toBe(false)
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenLastCalledWith(session.id, 'networks', expect.anything(), expect.anything()))
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  expect(view.result.current.busy).toBe(true)
  await act(async () => { expect(await view.result.current.action('data', { action: 'remove' })).toBe(false) })
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({ id: 'data', kind: 'volumes', action: 'remove', completed_at: '' }); await action })
  expect(view.result.current.busy).toBe(false)
})

test('写入失败保留错误且不自动重试；禁用后不接受旧事件', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.api.sessionDockerResourceAction.mockRejectedValue(new Error('volume is in use'))
  await act(async () => { expect(await view.result.current.action('data', { action: 'remove' })).toBe(false) })
  expect(view.result.current.actionError).toBe('volume is in use')
  expect(view.result.current.busy).toBe(false)
  const stale = view.result.current.action
  view.rerender({ current: session, kind: 'volumes', enabled: false })
  await act(async () => { expect(await stale('data', { action: 'remove' })).toBe(false) })
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
})

test('关闭详情后丢弃迟到的详情结果', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<Awaited<ReturnType<DockerGateway['sessionDockerResourceDetail']>>>()
  view.api.sessionDockerResourceDetail.mockReturnValue(pending.promise)
  let selecting!: Promise<void>
  act(() => { selecting = view.result.current.select('data') })
  await act(async () => { await view.result.current.select('') })
  await act(async () => { pending.resolve({ resource: { id: 'data', name: 'data', kind: 'volumes' }, internal: false, attachable: false, collected_at: '' }); await selecting })
  expect(view.result.current.selectedRef).toBe('')
  expect(view.result.current.detail).toBeNull()
})

test('资源模式共享能力探测，切回保留搜索、分页与详情且不重复读取', async () => {
  const view = setup()
  const detail = { resource: { id: 'data', name: 'data', kind: 'volumes' as const }, internal: false, attachable: false, collected_at: '' }
  view.api.sessionDockerResourceDetail.mockResolvedValue(detail)
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.api.sessionDockerResources.mockResolvedValueOnce({ ...list, offset: 100, filtered: 101, total: 101, items: [detail.resource] })
  await act(async () => {
    view.result.current.setSearch('data')
    await view.result.current.refresh('data', 100)
    await view.result.current.select('data')
  })
  for (const kind of ['images', 'networks'] as const) {
    view.rerender({ current: session, kind, enabled: true })
    await waitFor(() => expect(view.result.current.list).not.toBeNull())
  }
  const reads = view.api.sessionDockerResources.mock.calls.length
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  expect(view.result.current).toMatchObject({ search: 'data', query: 'data', offset: 100, selectedRef: 'data', detail })
  expect(view.api.sessionDockerCapability).toHaveBeenCalledTimes(1)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(reads)
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(1)
  await act(async () => { await view.result.current.select(''); await view.result.current.select('data') })
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(1)
})

test('缓存过期重新展示时保留原内容，后台更新失败不循环重试', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.rerender({ current: session, kind: 'volumes', enabled: false })
  const pending = deferred<DockerResourceList>()
  view.api.sessionDockerResources.mockReturnValueOnce(pending.promise)
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
  try {
    view.rerender({ current: session, kind: 'volumes', enabled: true })
    expect(view.result.current.list).toEqual(list)
    expect(view.result.current.loading).toBe(true)
    await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2))
    await act(async () => { pending.resolve({ ...list, total: 5 }) })
    expect(view.result.current.list?.total).toBe(5)
    view.api.sessionDockerResources.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.list?.total).toBe(5)
    expect(view.result.current.error).toBe('offline')
    expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3)
  } finally { now.mockRestore() }
})

test('手动刷新绕过列表、能力及详情缓存', async () => {
  const view = setup()
  view.api.sessionDockerResourceDetail.mockResolvedValue({ resource: { id: 'data', name: 'data', kind: 'volumes' }, internal: false, attachable: false, collected_at: '' })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  await act(async () => { await view.result.current.select('data') })
  await act(async () => { await view.result.current.refresh(undefined, undefined, true); await view.result.current.select('data', true) })
  expect(view.api.sessionDockerCapability).toHaveBeenCalledTimes(2)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2)
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(2)
})

test('未完成读取被切页取消后，返回可重取且旧响应不覆盖', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<DockerResourceList>()
  view.api.sessionDockerResources.mockReturnValueOnce(pending.promise)
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2))
  view.rerender({ current: session, kind: 'networks', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  await act(async () => { pending.resolve({ ...list, total: 999 }) })
  expect(view.result.current.list?.total).toBe(0)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(4)
})

test('更换 API 或断连重连后重新读取，不复用旧来源缓存', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const next = { ...view.api, sessionDockerResources: vi.fn<DockerGateway['sessionDockerResources']>(async () => ({ ...list, total: 10 })) }
  view.rerender({ current: session, kind: 'volumes', enabled: true, source: next })
  await waitFor(() => expect(view.result.current.list?.total).toBe(10))
  view.rerender({ current: { ...session, status: 'disconnected' }, kind: 'volumes', enabled: true, source: next })
  expect(view.result.current.list).toBeNull()
  view.rerender({ current: session, kind: 'volumes', enabled: true, source: next })
  await waitFor(() => expect(next.sessionDockerResources).toHaveBeenCalledTimes(2))
})

test('隐藏模式的失败写入使缓存失效，返回时补读并保留错误', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.api.sessionDockerResourceDetail.mockResolvedValue({ resource: { id: 'data', name: 'data', kind: 'volumes' }, internal: false, attachable: false, collected_at: '' })
  await act(async () => { await view.result.current.select('data') })
  let reject!: (error: Error) => void
  view.api.sessionDockerResourceAction.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  let action!: Promise<boolean>
  act(() => { action = view.result.current.action('data', { action: 'remove' }) })
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  await act(async () => { reject(new Error('uncertain')); await action })
  expect(view.result.current.actionError).toBe('')
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(view.result.current.actionError).toBe('uncertain')
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(2)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3)
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
})

test('断连前发起的删除完成后不清空重连后的详情', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<DockerResourceActionResult>()
  view.api.sessionDockerResourceAction.mockReturnValueOnce(pending.promise)
  view.api.sessionDockerResourceDetail.mockResolvedValue({ resource: { id: 'data', name: 'data', kind: 'volumes' }, internal: false, attachable: false, collected_at: '' })
  let action!: Promise<boolean>
  act(() => { action = view.result.current.action('data', { action: 'remove' }) })
  view.rerender({ current: { ...session, status: 'disconnected' }, kind: 'volumes', enabled: true })
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  await act(async () => { await view.result.current.select('data') })
  await act(async () => { pending.resolve({ id: 'data', kind: 'volumes', action: 'remove', completed_at: '' }); await action })
  expect(view.result.current.selectedRef).toBe('data')
  expect(view.result.current.detail?.resource.id).toBe('data')
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(2)
  expect(view.result.current.busy).toBe(false)
})

test('容器变更让已缓存资源失效，网络变更通知原会话的容器列表', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.rerender({ current: session, kind: 'images', enabled: true, revision: 1 })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3))
  view.rerender({ current: session, kind: 'volumes', enabled: true, revision: 1 })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(4))
  view.rerender({ current: session, kind: 'networks', enabled: true, revision: 1 })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  view.api.sessionDockerResourceAction.mockRejectedValueOnce(new Error('uncertain'))
  await act(async () => { await view.result.current.action('network', { action: 'connect', container: 'app' }) })
  expect(view.onContainersChanged).toHaveBeenCalledExactlyOnceWith(session.id)
})

test('缓存范围达到上限后淘汰旧会话，保留当前会话', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  for (let index = 0; index < 12; index++) {
    view.rerender({ current: { ...session, id: `ssh-${index}` }, kind: 'volumes', enabled: true })
    await waitFor(() => expect(view.result.current.list).not.toBeNull())
  }
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(14))
})

test('末页删除后回退到最近的有效页，保留筛选且不重放删除', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const item = { id: 'last', name: 'last', kind: 'volumes' as const }
  view.api.sessionDockerResources.mockResolvedValueOnce({ ...list, offset: 200, total: 201, filtered: 201, items: [item] })
  await act(async () => { await view.result.current.refresh('data', 200) })
  view.api.sessionDockerResources
    .mockResolvedValueOnce({ ...list, offset: 200, total: 200, filtered: 200 })
    .mockResolvedValueOnce({ ...list, offset: 100, total: 200, filtered: 200, items: [{ ...item, id: 'previous' }] })
  view.api.sessionDockerResourceAction.mockResolvedValueOnce({ id: 'last', kind: 'volumes', action: 'remove', completed_at: '' })
  await act(async () => { expect(await view.result.current.action('last', { action: 'remove' })).toBe(true) })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(view.result.current.offset).toBe(100)
  expect(view.result.current.list?.items[0].id).toBe('previous')
  expect(view.api.sessionDockerResources).toHaveBeenLastCalledWith(session.id, 'volumes', { query: 'data', offset: 100, limit: 100 }, expect.anything())
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
})

test('远端持续减少时分页仅补读一次，零结果直接回首页', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  view.api.sessionDockerResources
    .mockResolvedValueOnce({ ...list, offset: 200, filtered: 150, total: 150 })
    .mockResolvedValueOnce({ ...list, offset: 100, filtered: 80, total: 80 })
  await act(async () => { await view.result.current.refresh('', 200) })
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3)
  expect(view.result.current.loading).toBe(false)
  view.api.sessionDockerResources.mockResolvedValueOnce({ ...list, offset: 100 })
  await act(async () => { await view.result.current.refresh() })
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(4)
  expect(view.result.current.offset).toBe(0)
  expect(view.result.current.list?.offset).toBe(0)
})

test('分页回退途中切换模式，迟到的补读结果不会覆盖新列表', async () => {
  const view = setup()
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<DockerResourceList>()
  view.api.sessionDockerResources
    .mockResolvedValueOnce({ ...list, offset: 100, filtered: 10, total: 10 })
    .mockReturnValueOnce(pending.promise)
  let refresh!: Promise<void>
  act(() => { refresh = view.result.current.refresh('', 100) })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(3))
  const signal = view.api.sessionDockerResources.mock.calls[2][3]?.signal
  view.rerender({ current: session, kind: 'networks', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.resolve({ ...list, total: 10, filtered: 10 }); await refresh })
  expect(view.result.current.list?.total).toBe(0)
})

test('新能力探测同步其他模式，失效详情的迟到结果不会复活', async () => {
  const view = setup()
  const detail = { resource: { id: 'data', name: 'data', kind: 'volumes' as const }, internal: false, attachable: false, collected_at: '' }
  view.api.sessionDockerResourceDetail.mockResolvedValueOnce(detail)
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  await act(async () => { await view.result.current.select('data') })
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  const pending = deferred<typeof detail>()
  view.api.sessionDockerResourceDetail.mockReturnValueOnce(pending.promise)
  let selecting!: Promise<void>
  act(() => { selecting = view.result.current.select('image') })
  view.api.sessionDockerCapability.mockResolvedValueOnce({ available: false, status: 'daemon_unavailable', collected_at: '' })
  await act(async () => { await view.result.current.refresh(undefined, undefined, true) })
  expect(view.result.current.detailLoading).toBe(false)
  await act(async () => { pending.resolve(detail); await selecting })
  expect(view.result.current.detail).toBeNull()
  view.rerender({ current: session, kind: 'volumes', enabled: true })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(view.result.current).toMatchObject({ capability: { available: false }, list: null, detail: null, selectedRef: '' })
  await act(async () => { expect(await view.result.current.action('data', { action: 'remove' })).toBe(false) })
  expect(view.api.sessionDockerResourceAction).not.toHaveBeenCalled()
  expect(view.api.sessionDockerCapability).toHaveBeenCalledTimes(2)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2)
  await act(async () => { await view.result.current.refresh(undefined, undefined, true) })
  view.rerender({ current: session, kind: 'images', enabled: true })
  await waitFor(() => expect(view.result.current.list).not.toBeNull())
  expect(view.result.current.capability?.available).toBe(true)
  expect(view.api.sessionDockerCapability).toHaveBeenCalledTimes(3)
})
