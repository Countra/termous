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
  const api = { getStatus: state.snapshot, acceptStatus: state.accept.bind(state), eventsUrl: () => 'ws://termous.test/cloud/events' } as CloudGateway
  return { api, state }
}

test('HTTP 状态领先时仍消费同账号的数据失效消息，旧账号消息不会刷新目录', async () => {
  const { api, state } = gateway()
  const reload = vi.fn(async () => undefined)
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
  const reload = vi.fn(async () => undefined)
  const view = renderHook(({ blocked }) => useCloudSubscription(api, true, blocked, reload), { initialProps: { blocked: true } })
  await act(async () => FakeWebSocket.instances[0].receive({ type: 'datasets', status: { ...status, revision: 9 }, datasets: ['file_access_profiles'] }))
  expect(reload).not.toHaveBeenCalled()
  view.rerender({ blocked: false })
  await act(async () => vi.advanceTimersByTime(1500))
  expect(reload).toHaveBeenCalledWith(['file_access_profiles'], expect.any(Function))
})
