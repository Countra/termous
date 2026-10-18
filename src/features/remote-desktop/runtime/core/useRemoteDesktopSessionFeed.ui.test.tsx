import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RemoteDesktopGateway } from '../../api/remoteDesktopGateway.ts'
import { useRemoteDesktopSessionFeed } from './useRemoteDesktopSessionFeed.ts'

class Socket {
  static instances: Socket[] = []
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: MessageEvent<string>) => void
  onerror?: () => void
  constructor(readonly url: string) { Socket.instances.push(this) }
  close() { this.onclose?.() }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>) }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.instances.length = 0 })

it('视觉消息不触发会话 GET，断线前发出的 GET 及卸载后的旧事件不能恢复指针', async () => {
  vi.stubGlobal('WebSocket', Socket)
  let complete!: (sessions: []) => void
  const query = vi.fn(() => new Promise<[]>(resolve => { complete = resolve }))
  const api = { remoteDesktopSessions: query, remoteDesktopSessionEventsUrl: () => 'ws://localhost/events' } as unknown as RemoteDesktopGateway
  const options = { api, enabled: true, initialSessions: () => [], onSnapshot: vi.fn(), onUpsert: vi.fn(), onRemove: vi.fn(), onTelemetry: vi.fn(), onPointer: vi.fn(), onPointerDisconnect: vi.fn() }
  const hook = renderHook(() => useRemoteDesktopSessionFeed(options))
  await waitFor(() => expect(query).toHaveBeenCalledOnce())
  const socket = Socket.instances[0]!
  expect(new URL(socket.url).searchParams.get('automation_pointer')).toBe('1')
  const event = { type: 'automation_pointer', session_id: 'desktop', connection_generation: 1, revision: 2, pointer: null }
  act(() => { socket.emit(event); socket.emit({ type: 'automation_pointer', pointer: 'invalid' }) })
  expect(options.onPointer).toHaveBeenCalledExactlyOnceWith(event)
  expect(query).toHaveBeenCalledOnce()
  act(() => socket.close())
  expect(options.onPointerDisconnect).toHaveBeenCalledOnce()
  await act(async () => complete([]))
  expect(options.onSnapshot).toHaveBeenCalledTimes(1)
  hook.unmount()
  options.onPointerDisconnect.mockClear()
  socket.emit(event)
  socket.onclose?.()
  expect(options.onPointer).toHaveBeenCalledTimes(1)
  expect(options.onPointerDisconnect).not.toHaveBeenCalled()
})

it('重连后旧通道的消息、错误和关闭回调不能干扰新通道', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  const query = vi.fn(async () => [])
  const api = { remoteDesktopSessions: query, remoteDesktopSessionEventsUrl: () => 'ws://localhost/events' } as unknown as RemoteDesktopGateway
  const options = { api, enabled: true, initialSessions: () => [], onSnapshot: vi.fn(), onUpsert: vi.fn(), onRemove: vi.fn(), onTelemetry: vi.fn(), onPointer: vi.fn(), onPointerDisconnect: vi.fn() }
  const hook = renderHook(() => useRemoteDesktopSessionFeed(options))
  await act(async () => Promise.resolve())
  const previous = Socket.instances[0]!
  act(() => previous.close())
  act(() => vi.advanceTimersByTime(800))
  const current = Socket.instances[1]!
  const close = vi.spyOn(current, 'close')
  options.onPointerDisconnect.mockClear()
  const event = { type: 'automation_pointer', session_id: 'desktop', connection_generation: 1, revision: 2, pointer: null }
  act(() => { previous.emit(event); previous.onopen?.(); previous.onerror?.(); previous.onclose?.() })
  expect(options.onPointer).not.toHaveBeenCalled()
  expect(options.onPointerDisconnect).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(query).toHaveBeenCalledOnce()
  act(() => current.emit(event))
  expect(options.onPointer).toHaveBeenCalledExactlyOnceWith(event)
  hook.unmount()
})
