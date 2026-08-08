import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ForwardEvent } from '#entities/forward'
import type { HostReachabilityEvent } from '#entities/host'
import { useRealtimeStatusSubscriptions } from './useRealtimeStatusSubscriptions'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  closeCalls = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  receive(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  fail() {
    this.onerror?.(new Event('error'))
  }

  disconnect() {
    this.onclose?.(new CloseEvent('close'))
  }

  close() {
    this.closeCalls += 1
    this.disconnect()
  }
}

const forwardEvent = {
  type: 'snapshot',
  forward: { id: 'forward-1' },
} as ForwardEvent

const reachabilityEvent: HostReachabilityEvent = {
  type: 'snapshot',
  items: [],
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('未就绪时不建立实时状态连接', () => {
  renderHook(() => useRealtimeStatusSubscriptions({
    enabled: false,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    onForwardEvent: vi.fn(),
    reloadForwards: vi.fn(async () => undefined),
    onHostReachabilityEvent: vi.fn(),
  }))

  expect(FakeWebSocket.instances).toEqual([])
})

test('实时状态连接解析合法消息并按各自延迟重连', async () => {
  const onForwardEvent = vi.fn()
  const reloadForwards = vi.fn(async () => undefined)
  const onHostReachabilityEvent = vi.fn()
  renderHook(() => useRealtimeStatusSubscriptions({
    enabled: true,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    onForwardEvent,
    reloadForwards,
    onHostReachabilityEvent,
  }))

  const [forwardSocket, reachabilitySocket] = FakeWebSocket.instances
  forwardSocket.open()
  forwardSocket.receive('{invalid')
  forwardSocket.receive(JSON.stringify(forwardEvent))
  reachabilitySocket.receive('{invalid')
  reachabilitySocket.receive(JSON.stringify(reachabilityEvent))

  expect(reloadForwards).toHaveBeenCalledTimes(1)
  expect(onForwardEvent).toHaveBeenCalledWith(forwardEvent)
  expect(onHostReachabilityEvent).toHaveBeenCalledWith(reachabilityEvent)

  forwardSocket.disconnect()
  reachabilitySocket.disconnect()
  await act(async () => vi.advanceTimersByTime(1_199))
  expect(FakeWebSocket.instances).toHaveLength(2)
  await act(async () => vi.advanceTimersByTime(1))
  expect(FakeWebSocket.instances).toHaveLength(3)
  expect(FakeWebSocket.instances[2]?.url).toBe('ws://termous.test/forwards')
  await act(async () => vi.advanceTimersByTime(300))
  expect(FakeWebSocket.instances).toHaveLength(4)
  expect(FakeWebSocket.instances[3]?.url).toBe('ws://termous.test/reachability')
})

test('回调更新不会重建连接且卸载后不再重连', () => {
  const firstForwardHandler = vi.fn()
  const nextForwardHandler = vi.fn()
  const stableForwardUrl = () => 'ws://termous.test/forwards'
  const stableReachabilityUrl = () => 'ws://termous.test/reachability'
  const { rerender, unmount } = renderHook(
    ({ onForwardEvent }) => useRealtimeStatusSubscriptions({
      enabled: true,
      forwardEventsUrl: stableForwardUrl,
      hostReachabilityEventsUrl: stableReachabilityUrl,
      onForwardEvent,
      reloadForwards: async () => undefined,
      onHostReachabilityEvent: () => undefined,
    }),
    { initialProps: { onForwardEvent: firstForwardHandler } },
  )

  const forwardSocket = FakeWebSocket.instances[0]
  rerender({ onForwardEvent: nextForwardHandler })
  expect(FakeWebSocket.instances).toHaveLength(2)
  forwardSocket.receive(JSON.stringify(forwardEvent))
  expect(firstForwardHandler).not.toHaveBeenCalled()
  expect(nextForwardHandler).toHaveBeenCalledWith(forwardEvent)

  unmount()
  vi.runAllTimers()
  expect(FakeWebSocket.instances).toHaveLength(2)
})

test('连接错误会主动关闭 socket', () => {
  const { unmount } = renderHook(() => useRealtimeStatusSubscriptions({
    enabled: true,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    onForwardEvent: () => undefined,
    reloadForwards: async () => undefined,
    onHostReachabilityEvent: () => undefined,
  }))

  const forwardSocket = FakeWebSocket.instances[0]
  forwardSocket.fail()
  expect(forwardSocket.closeCalls).toBe(1)
  unmount()
})
