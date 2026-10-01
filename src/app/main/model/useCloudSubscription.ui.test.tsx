import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CloudEvent, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { useCloudSubscription } from './useCloudSubscription'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  constructor() { FakeWebSocket.instances.push(this) }
  close() { this.onclose?.() }
  receive(event: CloudEvent) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) })) }
}

const status: CloudStatus = { generation: 'account-a', revision: 10, configured: true, authenticated: true, phase: 'ready', confirmed: true, auto_sync: true, pending: 0, conflicts: 0 }

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function gateway() {
  const state = new CloudState()
  state.accept(status)
  const api = { getStatus: state.snapshot, acceptStatus: state.accept.bind(state), acceptEvent: state.acceptEvent.bind(state), eventsUrl: () => 'ws://termous.test/cloud/events' } as CloudGateway
  return { api, state }
}

test('HTTP 状态领先时仍消费同账号的数据失效消息，旧账号消息不会刷新目录', async () => {
  const { api, state } = gateway()
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  renderHook(() => useCloudSubscription(api, true, false, reload))
  const socket = FakeWebSocket.instances[0]
  await act(async () => socket.receive({ type: 'datasets', status: { ...status, revision: 9 }, datasets: ['hosts'] }))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(reload).toHaveBeenCalledWith(['hosts'], expect.any(Function))
  expect(state.snapshot()?.revision).toBe(10)
  state.accept({ ...status, generation: 'account-b', revision: 11 })
  await act(async () => socket.receive({ type: 'datasets', status: { ...status, revision: 12 }, datasets: ['credentials'] }))
  expect(reload).toHaveBeenCalledTimes(1)
})

test('编辑草稿期间保留失效提示，解除保护后局部刷新', async () => {
  const { api } = gateway()
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  const view = renderHook(({ blocked }) => useCloudSubscription(api, true, blocked, reload), { initialProps: { blocked: true } })
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status: { ...status, revision: 9 }, datasets: ['file_access_profiles'] }))
  expect(reload).not.toHaveBeenCalled()
  view.rerender({ blocked: false })
  await act(async () => {})
  expect(reload).toHaveBeenCalledWith(['file_access_profiles'], expect.any(Function))
})

test('刷新期间的新数据提示在当前刷新结束后立即补读，无空闲轮询', async () => {
  const { api } = gateway()
  let finish!: () => void
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  reload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  renderHook(() => useCloudSubscription(api, true, false, reload))
  const socket = FakeWebSocket.instances[0]
  await act(async () => socket.receive({ type: 'datasets', status, datasets: ['hosts'] }))
  await act(async () => socket.receive({ type: 'datasets', status, datasets: ['credentials'] }))
  expect(reload).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  expect(reload).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenLastCalledWith(['credentials'], expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => vi.advanceTimersByTime(120_000))
  expect(reload).toHaveBeenCalledTimes(2)
})

test('仅失败的待办安排重试，成功后停止请求且保留数据失效范围', async () => {
  const { api } = gateway()
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {}).mockRejectedValueOnce(new Error('synthetic-network-failure'))
  renderHook(() => useCloudSubscription(api, true, false, reload))
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status, datasets: ['hosts'] }))
  expect(reload).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTime(1000))
  expect(reload).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenLastCalledWith(['hosts'], expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => vi.advanceTimersByTime(60_000))
  expect(reload).toHaveBeenCalledTimes(2)
})

test('替换Core网关后旧在途刷新不能挡住新连接或重排旧数据', async () => {
  const previous = gateway(), next = gateway()
  let finish!: () => void
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  reload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderHook(({ api }) => useCloudSubscription(api, true, false, reload), { initialProps: { api: previous.api } })
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status, datasets: ['hosts'] }))
  const oldCurrent = reload.mock.calls[0][1]
  view.rerender({ api: next.api })
  await act(async () => FakeWebSocket.instances[1].receive({ type: 'datasets', status, datasets: ['credentials'] }))
  expect(reload).toHaveBeenCalledTimes(2)
  expect(oldCurrent()).toBe(false)
  await act(async () => { finish(); vi.advanceTimersByTime(60_000) })
  expect(reload).toHaveBeenCalledTimes(2)
})

test('刷新期间进入并退出编辑，旧读取不能恢复有效且解除保护后立即补读', async () => {
  const { api } = gateway()
  let finish!: () => void
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  reload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderHook(({ blocked }) => useCloudSubscription(api, true, blocked, reload), { initialProps: { blocked: false } })
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status, datasets: ['hosts'] }))
  const previous = reload.mock.calls[0][1]
  view.rerender({ blocked: true })
  expect(previous()).toBe(false)
  view.rerender({ blocked: false })
  expect(previous()).toBe(false)
  await act(async () => { finish() })
  expect(reload).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenLastCalledWith(['hosts'], expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
})

test('编辑使在途读取失效时保留待办，不启动网络重试且退出编辑立即刷新', async () => {
  const { api } = gateway()
  let reject!: (cause: Error) => void
  const reload = vi.fn<(datasets: string[], current: () => boolean) => Promise<void>>(async () => {})
  reload.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
  const view = renderHook(({ blocked }) => useCloudSubscription(api, true, blocked, reload), { initialProps: { blocked: false } })
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status, datasets: ['hosts'] }))
  view.rerender({ blocked: true })
  await act(async () => { reject(new Error('cloud_refresh_deferred')) })
  expect(reload).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  view.rerender({ blocked: false })
  await act(async () => {})
  expect(reload).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenLastCalledWith(['hosts'], expect.any(Function))
})
