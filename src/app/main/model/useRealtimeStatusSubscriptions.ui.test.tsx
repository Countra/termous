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
    snippetEventsUrl: () => 'ws://termous.test/snippets',
    onForwardEvent: vi.fn(),
    reloadForwards: vi.fn(async () => undefined),
    reloadSnippets: vi.fn(async () => undefined),
    resetSnippetEventCursor: vi.fn(),
    onHostReachabilityEvent: vi.fn(),
  }))

  expect(FakeWebSocket.instances).toEqual([])
})

test('实时状态连接解析合法消息并按各自延迟重连', async () => {
  const onForwardEvent = vi.fn()
  const reloadForwards = vi.fn(async () => undefined)
  const reloadSnippets = vi.fn(async () => undefined)
  const resetSnippetEventCursor = vi.fn()
  const onHostReachabilityEvent = vi.fn()
  renderHook(() => useRealtimeStatusSubscriptions({
    enabled: true,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    snippetEventsUrl: () => 'ws://termous.test/snippets',
    onForwardEvent,
    reloadForwards,
    reloadSnippets,
    resetSnippetEventCursor,
    onHostReachabilityEvent,
  }))

  const [forwardSocket, reachabilitySocket, snippetSocket] = FakeWebSocket.instances
  forwardSocket.open()
  forwardSocket.receive('{invalid')
  forwardSocket.receive(JSON.stringify(forwardEvent))
  reachabilitySocket.receive('{invalid')
  reachabilitySocket.receive(JSON.stringify(reachabilityEvent))
  snippetSocket.open()
  snippetSocket.receive('{invalid')
  snippetSocket.receive(JSON.stringify({ type: 'snapshot', revision: 4 }))
  snippetSocket.receive(JSON.stringify({ type: 'changed', revision: -1 }))
  snippetSocket.receive(JSON.stringify({ type: 'changed', revision: 4 }))

  expect(reloadForwards).toHaveBeenCalledTimes(1)
  expect(onForwardEvent).toHaveBeenCalledWith(forwardEvent)
  expect(onHostReachabilityEvent).toHaveBeenCalledWith(reachabilityEvent)
  expect(resetSnippetEventCursor).toHaveBeenCalledTimes(1)
  expect(reloadSnippets).toHaveBeenCalledTimes(1)
  expect(reloadSnippets).toHaveBeenCalledWith(4)

  forwardSocket.disconnect()
  reachabilitySocket.disconnect()
  snippetSocket.disconnect()
  await act(async () => vi.advanceTimersByTime(1_199))
  expect(FakeWebSocket.instances).toHaveLength(3)
  await act(async () => vi.advanceTimersByTime(1))
  expect(FakeWebSocket.instances).toHaveLength(4)
  expect(FakeWebSocket.instances[3]?.url).toBe('ws://termous.test/forwards')
  await act(async () => vi.advanceTimersByTime(100))
  expect(FakeWebSocket.instances).toHaveLength(5)
  expect(FakeWebSocket.instances[4]?.url).toBe('ws://termous.test/snippets')
  await act(async () => vi.advanceTimersByTime(200))
  expect(FakeWebSocket.instances).toHaveLength(6)
  expect(FakeWebSocket.instances[5]?.url).toBe('ws://termous.test/reachability')
})

test('回调更新不会重建连接且卸载后不再重连', () => {
  const firstForwardHandler = vi.fn()
  const nextForwardHandler = vi.fn()
  const stableForwardUrl = () => 'ws://termous.test/forwards'
  const stableReachabilityUrl = () => 'ws://termous.test/reachability'
  const stableSnippetUrl = () => 'ws://termous.test/snippets'
  const { rerender, unmount } = renderHook(
    ({ onForwardEvent }) => useRealtimeStatusSubscriptions({
      enabled: true,
      forwardEventsUrl: stableForwardUrl,
      hostReachabilityEventsUrl: stableReachabilityUrl,
      snippetEventsUrl: stableSnippetUrl,
      onForwardEvent,
      reloadForwards: async () => undefined,
      reloadSnippets: async () => undefined,
      resetSnippetEventCursor: () => undefined,
      onHostReachabilityEvent: () => undefined,
    }),
    { initialProps: { onForwardEvent: firstForwardHandler } },
  )

  const forwardSocket = FakeWebSocket.instances[0]
  rerender({ onForwardEvent: nextForwardHandler })
  expect(FakeWebSocket.instances).toHaveLength(3)
  forwardSocket.receive(JSON.stringify(forwardEvent))
  expect(firstForwardHandler).not.toHaveBeenCalled()
  expect(nextForwardHandler).toHaveBeenCalledWith(forwardEvent)

  unmount()
  vi.runAllTimers()
  expect(FakeWebSocket.instances).toHaveLength(3)
})

test('连接错误会主动关闭 socket', () => {
  const { unmount } = renderHook(() => useRealtimeStatusSubscriptions({
    enabled: true,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    snippetEventsUrl: () => 'ws://termous.test/snippets',
    onForwardEvent: () => undefined,
    reloadForwards: async () => undefined,
    reloadSnippets: async () => undefined,
    resetSnippetEventCursor: () => undefined,
    onHostReachabilityEvent: () => undefined,
  }))

  const forwardSocket = FakeWebSocket.instances[0]
  forwardSocket.fail()
  expect(forwardSocket.closeCalls).toBe(1)
  unmount()
})

test('代码片段刷新失败会关闭当前连接并按延迟重连', async () => {
  const reloadSnippets = vi.fn(async () => {
    throw new Error('temporary failure')
  })
  renderHook(() => useRealtimeStatusSubscriptions({
    enabled: true,
    forwardEventsUrl: () => 'ws://termous.test/forwards',
    hostReachabilityEventsUrl: () => 'ws://termous.test/reachability',
    snippetEventsUrl: () => 'ws://termous.test/snippets',
    onForwardEvent: () => undefined,
    reloadForwards: async () => undefined,
    reloadSnippets,
    resetSnippetEventCursor: () => undefined,
    onHostReachabilityEvent: () => undefined,
  }))

  const snippetSocket = FakeWebSocket.instances[2]
  await act(async () => {
    snippetSocket.receive(JSON.stringify({ type: 'changed', revision: 6 }))
    await Promise.resolve()
  })

  expect(snippetSocket.closeCalls).toBe(1)
  await act(async () => vi.advanceTimersByTime(1_299))
  expect(FakeWebSocket.instances).toHaveLength(3)
  await act(async () => vi.advanceTimersByTime(1))
  expect(FakeWebSocket.instances).toHaveLength(4)
  expect(FakeWebSocket.instances[3]?.url).toBe('ws://termous.test/snippets')
})
