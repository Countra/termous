import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useFileSessionSnapshotSubscription } from './useFileSessionSnapshotSubscription'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
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

const legacyFileSession = {
  id: 'file-session-a',
  host_id: 'host-a',
  file_access_profile_id: 'file-profile-a',
  ssh_profile_id: 'ssh-profile-a',
  engine: 'sftp',
  namespace: 'posix',
  capabilities: ['browse'],
  status: 'connected',
  phase: 'ready',
  current_path: '/',
  started_at: '2026-08-17T00:00:00Z',
  connection_generation: 1,
  state_seq: 1,
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

test('文件会话全局快照复用重连循环并隔离旧连接迟到帧', async () => {
  const onSnapshot = vi.fn()
  const view = renderHook(() => useFileSessionSnapshotSubscription({
    enabled: true,
    eventsUrl: () => 'ws://termous.test/api/v1/file-sessions/events',
    onSnapshot,
  }))
  const firstSocket = FakeWebSocket.instances[0]!

  firstSocket.receive(JSON.stringify({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 1,
    sessions: [legacyFileSession],
  }))
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
    sessions: [expect.objectContaining({ origin: 'app' })],
  }), 1)

  firstSocket.disconnect()
  await act(async () => vi.advanceTimersByTime(1_200))
  const secondSocket = FakeWebSocket.instances[1]!
  firstSocket.receive(JSON.stringify({
    type: 'file_session_snapshot',
    instance_id: 'late',
    revision: 99,
    sessions: [],
  }))
  expect(onSnapshot).toHaveBeenCalledTimes(1)

  secondSocket.receive(JSON.stringify({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 2,
    sessions: [{ ...legacyFileSession, origin: 'mcp' }],
  }))
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
    revision: 2,
    sessions: [expect.objectContaining({ origin: 'mcp' })],
  }), 2)

  view.unmount()
})

test('非法来源快照不会中断后续文件会话同步', () => {
  const onSnapshot = vi.fn()
  renderHook(() => useFileSessionSnapshotSubscription({
    enabled: true,
    eventsUrl: () => 'ws://termous.test/api/v1/file-sessions/events',
    onSnapshot,
  }))
  const socket = FakeWebSocket.instances[0]!

  socket.receive(JSON.stringify({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 1,
    sessions: [{ ...legacyFileSession, origin: 'external' }],
  }))
  socket.receive(JSON.stringify({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 2,
    sessions: [{ ...legacyFileSession, origin: 'app' }],
  }))

  expect(onSnapshot).toHaveBeenCalledTimes(1)
  expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), 1)
})
