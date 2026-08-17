import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useSessionSnapshotSubscription } from './useSessionSnapshotSubscription'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static constructorFailures = 0

  readonly url: string
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    if (FakeWebSocket.constructorFailures > 0) {
      FakeWebSocket.constructorFailures -= 1
      throw new Error('WebSocket constructor failed')
    }
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  receive(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  disconnect() {
    this.onclose?.(new CloseEvent('close'))
  }

  close() {
    this.disconnect()
  }
}

const snapshot = {
  type: 'session_snapshot',
  instance_id: 'core-a',
  revision: 1,
  sessions: [{
    id: 'session-a',
    kind: 'ssh',
    status: 'connected',
    started_at: '2026-08-13T08:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }],
}

const normalizedSnapshot = {
  ...snapshot,
  sessions: [{ ...snapshot.sessions[0], origin: 'app' }],
}

beforeEach(() => {
  FakeWebSocket.instances = []
  FakeWebSocket.constructorFailures = 0
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('全局会话快照连接校验消息并隔离旧连接的迟到帧', async () => {
  const onSnapshot = vi.fn()
  const view = renderHook(() => useSessionSnapshotSubscription({
    enabled: true,
    eventsUrl: () => 'ws://termous.test/api/v1/sessions/events',
    onSnapshot,
  }))

  const firstSocket = FakeWebSocket.instances[0]
  firstSocket.receive('{invalid')
  firstSocket.receive(JSON.stringify(snapshot))
  expect(onSnapshot).toHaveBeenLastCalledWith(normalizedSnapshot, 1)

  firstSocket.disconnect()
  await act(async () => vi.advanceTimersByTime(1_200))
  const secondSocket = FakeWebSocket.instances[1]
  expect(secondSocket.url).toBe('ws://termous.test/api/v1/sessions/events')

  firstSocket.receive(JSON.stringify({ ...snapshot, revision: 99 }))
  expect(onSnapshot).toHaveBeenCalledTimes(1)
  secondSocket.receive(JSON.stringify({ ...snapshot, revision: 2 }))
  expect(onSnapshot).toHaveBeenLastCalledWith({ ...normalizedSnapshot, revision: 2 }, 2)

  view.unmount()
  vi.runAllTimers()
  expect(FakeWebSocket.instances).toHaveLength(2)
})

test('禁用时不建立会话快照连接', () => {
  renderHook(() => useSessionSnapshotSubscription({
    enabled: false,
    eventsUrl: () => 'ws://termous.test/api/v1/sessions/events',
    onSnapshot: vi.fn(),
  }))

  expect(FakeWebSocket.instances).toEqual([])
})

test('WebSocket 构造失败时保持订阅并在延迟后重连', async () => {
  FakeWebSocket.constructorFailures = 1
  const onSnapshot = vi.fn()

  renderHook(() => useSessionSnapshotSubscription({
    enabled: true,
    eventsUrl: () => 'ws://termous.test/api/v1/sessions/events',
    onSnapshot,
  }))

  expect(FakeWebSocket.instances).toEqual([])
  await act(async () => vi.advanceTimersByTime(1_200))
  expect(FakeWebSocket.instances).toHaveLength(1)

  FakeWebSocket.instances[0]?.receive(JSON.stringify(snapshot))
  expect(onSnapshot).toHaveBeenCalledWith(normalizedSnapshot, 2)
})
