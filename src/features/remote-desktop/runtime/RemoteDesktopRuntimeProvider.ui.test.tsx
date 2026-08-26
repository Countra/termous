import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAttachTicket,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '../api/remoteDesktopGateway'
import { RemoteDesktopViewport } from '../ui/RemoteDesktopViewport'
import { useRemoteDesktopConnectionMetrics } from './core/connectionMetricsStore'
import { useRemoteDesktopRuntime } from './core/remoteDesktopRuntimeContext'
import { RemoteDesktopTargetAuthController } from './core/targetAuthController.ts'
import { RemoteDesktopRuntimeProvider } from './RemoteDesktopRuntimeProvider'

const adapterCreate = vi.hoisted(() => vi.fn())
const adapterPrepare = vi.hoisted(() => vi.fn())

vi.mock('./protocols/vnc/noVncAdapter.ts', () => ({
  prepareVncViewerAdapter: adapterPrepare,
  VncViewerAdapter: { create: adapterCreate },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  adapterCreate.mockReset()
  adapterPrepare.mockReset()
  MockWebSocket.instances.length = 0
})

test('目标握手前失败后同一代际的状态刷新不会重复申请 Ticket', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  let adapterEvents: { onDisconnected: (clean: boolean) => void } | null = null
  const adapter = {
    dispose: vi.fn(),
    setViewportActive: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
  }
  adapterCreate.mockImplementation(async (options: typeof adapterCreate extends never ? never : { events: typeof adapterEvents }) => {
    adapterEvents = options.events
    return adapter
  })
  const api = remoteDesktopGateway(session, ticket)

  render(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(ticket).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  act(() => adapterEvents?.onDisconnected(false))

  const socket = MockWebSocket.instances[0]
  act(() => socket.emit({
    type: 'upsert',
    session: { ...session, updated_at: '2026-08-23T12:00:01Z' },
  }))
  await act(async () => Promise.resolve())
  expect(ticket).toHaveBeenCalledTimes(1)

  act(() => socket.emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:02Z',
    },
  }))
  await waitFor(() => expect(ticket).toHaveBeenCalledTimes(2))
})

test('协议模块准备完成前不会申请短时 Ticket', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const prepared = deferred<void>()
  const ticket = vi.fn(async () => ({
    ticket: 'ticket-1',
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: 1,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  adapterPrepare.mockReturnValue(prepared.promise)
  adapterCreate.mockResolvedValue(viewerAdapter())

  render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, ticket)}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterPrepare).toHaveBeenCalledTimes(1))
  expect(ticket).not.toHaveBeenCalled()
  prepared.resolve()
  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 1))
})

test('Viewer 创建失败后立即清理已申请的目标认证票据', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const clear = vi.spyOn(RemoteDesktopTargetAuthController.prototype, 'clear')
  adapterCreate.mockRejectedValue(new Error('viewer create failed'))

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, vi.fn(async () => ({
        ticket: 'ticket-1',
        credential_ticket: 'credential-ticket-1',
        expires_at: '2026-08-23T12:00:30Z',
        connection_generation: 1,
        stream_path: '/api/v1/remote-desktop-stream',
      })))}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerAttachHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(view.getByTestId('viewer-error')).toHaveTextContent('attach_failed'))
  expect(clear).toHaveBeenCalledTimes(2)
})

test('Profile 编辑或缺失后既有 Session 仍按固化 Driver 快照重建 Viewer', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const profile = remoteDesktopProfile()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  adapterCreate.mockResolvedValue(viewerAdapter())
  const api = remoteDesktopGateway(session, ticket)
  const view = render(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[profile]} initialSessions={[session]}>
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  view.rerender(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[{ ...profile, name: 'Edited profile' }]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )
  expect(adapterCreate).toHaveBeenCalledTimes(1)

  view.rerender(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[]} initialSessions={[session]}>
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:02Z',
    },
  }))

  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 2))
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(2))
})

test('VNC 仅在 password-only 挑战时消费目标认证票据并自动提交', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const adapter = viewerAdapter()
  let requestCredentials: ((types: string[]) => void) | undefined
  adapterCreate.mockImplementation(async (options: {
    events: { onCredentialsRequired: (types: string[]) => void }
  }) => {
    requestCredentials = options.events.onCredentialsRequired
    return adapter
  })
  const api = remoteDesktopGateway(session, vi.fn(async () => ({
    ticket: 'ticket-1',
    credential_ticket: 'credential-ticket-1',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: 1,
    stream_path: '/api/v1/remote-desktop-stream',
  })))
  api.consumeRemoteDesktopTargetAuth = vi.fn(async () => ({ password: 'saved-password' }))

  const view = render(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[]} initialSessions={[session]}>
      <ViewerCredentialHarness />
    </RemoteDesktopRuntimeProvider>,
  )
  await waitFor(() => expect(requestCredentials).toBeTypeOf('function'))
  act(() => requestCredentials?.(['password']))

  await waitFor(() => expect(api.consumeRemoteDesktopTargetAuth).toHaveBeenCalledWith(
    session.id,
    1,
    'credential-ticket-1',
  ))
  await waitFor(() => expect(adapter.sendCredentials).toHaveBeenCalledWith({
    password: 'saved-password',
  }))
  expect(view.getByTestId('viewer-credentials')).toHaveTextContent('connecting:0')
})

test('目标认证读取失败时回退手工认证且不重复消费票据', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const adapter = viewerAdapter()
  let requestCredentials: ((types: string[]) => void) | undefined
  adapterCreate.mockImplementation(async (options: {
    events: { onCredentialsRequired: (types: string[]) => void }
  }) => {
    requestCredentials = options.events.onCredentialsRequired
    return adapter
  })
  const api = remoteDesktopGateway(session, vi.fn(async () => ({
    ticket: 'ticket-1',
    credential_ticket: 'credential-ticket-1',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: 1,
    stream_path: '/api/v1/remote-desktop-stream',
  })))
  api.consumeRemoteDesktopTargetAuth = vi.fn(async () => {
    throw new Error('credential unavailable')
  })

  const view = render(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[]} initialSessions={[session]}>
      <ViewerCredentialHarness />
    </RemoteDesktopRuntimeProvider>,
  )
  await waitFor(() => expect(requestCredentials).toBeTypeOf('function'))
  act(() => requestCredentials?.(['password']))

  await waitFor(() => expect(view.getByTestId('viewer-credentials')).toHaveTextContent(
    'credentials_required:1',
  ))
  act(() => requestCredentials?.(['password']))
  expect(api.consumeRemoteDesktopTargetAuth).toHaveBeenCalledTimes(1)
  expect(adapter.sendCredentials).not.toHaveBeenCalled()
})

test('reattach_wait 先于 noVNC 断开回调时仍会重新附加 Viewer', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const adapterEvents: Array<{
    onConnected: () => void
    onDisconnected: (clean: boolean) => void
  }> = []
  const adapters = [viewerAdapter(), viewerAdapter()]
  adapterCreate.mockImplementation(async (options: { events: typeof adapterEvents[number] }) => {
    adapterEvents.push(options.events)
    return adapters[adapterEvents.length - 1]
  })

  render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, ticket)}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterEvents).toHaveLength(1))
  act(() => adapterEvents[0].onConnected())
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      status: 'reattach_wait',
      phase: 'waiting_reattach',
      viewer_attached: false,
      updated_at: '2026-08-23T12:00:01Z',
    },
  }))
  await act(async () => Promise.resolve())
  expect(ticket).toHaveBeenCalledTimes(1)

  act(() => adapterEvents[0].onDisconnected(false))

  await waitFor(() => expect(ticket).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(2))
})

test('旧 generation 的 Ticket 迟到失败不会清除新 generation 的附加任务', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const firstTicket = deferred<RemoteDesktopAttachTicket>()
  const secondTicket = deferred<RemoteDesktopAttachTicket>()
  const ticket = vi.fn((_id: string, generation: number) => (
    generation === 1 ? firstTicket.promise : secondTicket.promise
  ))
  adapterCreate.mockResolvedValue(viewerAdapter())

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, ticket)}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerAttachHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:01Z',
    },
  }))
  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 2))

  await act(async () => {
    firstTicket.reject(new Error('stale ticket failed'))
    await Promise.resolve()
  })
  expect(view.getByTestId('viewer-error')).not.toHaveTextContent('attach_failed')

  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:02Z',
    },
  }))
  await act(async () => Promise.resolve())
  expect(ticket).toHaveBeenCalledTimes(2)

  await act(async () => {
    secondTicket.resolve({
      ticket: 'ticket-2',
      credential_ticket: '',
      expires_at: '2026-08-23T12:00:30Z',
      connection_generation: 2,
      stream_path: '/api/v1/remote-desktop-stream',
    })
    await secondTicket.promise
  })
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
})

test('事件流重连后的 snapshot 会迁移 Viewer generation 并重新附加', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const firstAdapter = viewerAdapter()
  const secondAdapter = viewerAdapter()
  adapterCreate
    .mockResolvedValueOnce(firstAdapter)
    .mockResolvedValueOnce(secondAdapter)

  render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, ticket)}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'snapshot',
    sessions: [{
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:02Z',
    }],
  }))

  await waitFor(() => expect(ticket).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(2))
  expect(firstAdapter.dispose).toHaveBeenCalledTimes(1)
})

test('telemetry 仅更新当前会话 generation 并在重连状态清空', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  adapterCreate.mockResolvedValue(viewerAdapter())
  const view = render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, vi.fn(async () => ({
        ticket: 'ticket-1',
        credential_ticket: '',
        expires_at: '2026-08-23T12:00:30Z',
        connection_generation: 1,
        stream_path: '/api/v1/remote-desktop-stream',
      })))}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
      <MetricsHarness sessionId={session.id} />
    </RemoteDesktopRuntimeProvider>,
  )

  const socket = MockWebSocket.instances[0]
  act(() => socket.emit({
    type: 'telemetry',
    session_id: session.id,
    connection_generation: 2,
    ssh_rtt_ms: 99,
    sampled_at: '2026-08-24T08:00:00Z',
  }))
  expect(view.getByTestId('ssh-rtt')).toHaveTextContent('--')

  act(() => socket.emit({
    type: 'telemetry',
    session_id: session.id,
    connection_generation: 1,
    ssh_rtt_ms: 25,
    sampled_at: '2026-08-24T08:00:01Z',
  }))
  expect(view.getByTestId('ssh-rtt')).toHaveTextContent('25')

  act(() => socket.emit({
    type: 'upsert',
    session: {
      ...session,
      status: 'reconnecting',
      phase: 'waiting_retry',
      updated_at: '2026-08-24T08:00:02Z',
    },
  }))
  expect(view.getByTestId('ssh-rtt')).toHaveTextContent('--')
})

test('迟到的 GET 不会覆盖事件流已经推进的 Viewer generation', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  let resolveSnapshot!: (sessions: RemoteDesktopSession[]) => void
  const api = remoteDesktopGateway(session, vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  })))
  api.remoteDesktopSessions = vi.fn(() => new Promise<RemoteDesktopSession[]>((resolve) => {
    resolveSnapshot = resolve
  }))
  const adapters = [viewerAdapter(), viewerAdapter()]
  adapterCreate
    .mockResolvedValueOnce(adapters[0])
    .mockResolvedValueOnce(adapters[1])

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerControlHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:02Z',
    },
  }))
  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(2))
  expect(view.getByTestId('session-generation')).toHaveTextContent('2')

  await act(async () => {
    resolveSnapshot([session])
    await Promise.resolve()
  })

  expect(view.getByTestId('session-generation')).toHaveTextContent('2')
  expect(adapters[1].dispose).not.toHaveBeenCalled()
})

test('迟到的 GET 不会复活事件流已经删除的会话', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  let resolveSnapshot!: (sessions: RemoteDesktopSession[]) => void
  const api = remoteDesktopGateway(session, vi.fn(async () => ({
    ticket: 'ticket-1',
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: 1,
    stream_path: '/api/v1/remote-desktop-stream',
  })))
  api.remoteDesktopSessions = vi.fn(() => new Promise<RemoteDesktopSession[]>((resolve) => {
    resolveSnapshot = resolve
  }))
  const adapter = viewerAdapter()
  adapterCreate.mockResolvedValue(adapter)

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerControlHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'removed',
    session: { id: session.id },
  }))
  await waitFor(() => expect(view.queryByTestId('close-session')).not.toBeInTheDocument())

  await act(async () => {
    resolveSnapshot([session])
    await Promise.resolve()
  })

  expect(view.queryByTestId('close-session')).not.toBeInTheDocument()
  expect(adapter.dispose).toHaveBeenCalledTimes(1)
})

test('创建响应迟于 ready 事件时不会把会话回退到 connecting', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const readySession = remoteDesktopSession()
  const queuedSession: RemoteDesktopSession = {
    ...readySession,
    status: 'connecting',
    phase: 'queued',
    status_message: 'created',
    connection_generation: 0,
    updated_at: '2026-08-23T11:59:59.999999999Z',
  }
  const creation = deferred<RemoteDesktopSession>()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const api = remoteDesktopGateway(readySession, ticket)
  api.remoteDesktopSessions = vi.fn(async () => [])
  api.createRemoteDesktopSession = vi.fn(() => creation.promise)
  adapterCreate.mockResolvedValue(viewerAdapter())

  const view = render(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[]} initialSessions={[]}>
      <SessionMutationHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  fireEvent.click(view.getByTestId('create-session'))
  await waitFor(() => expect(api.createRemoteDesktopSession).toHaveBeenCalledWith('rdp_test'))
  act(() => MockWebSocket.instances[0].emit({ type: 'upsert', session: readySession }))
  await waitFor(() => expect(view.getByTestId('session-status')).toHaveTextContent('ready:1'))
  await waitFor(() => expect(ticket).toHaveBeenCalledWith(readySession.id, 1))

  await act(async () => {
    creation.resolve(queuedSession)
    await creation.promise
  })

  expect(view.getByTestId('session-status')).toHaveTextContent('ready:1')
  expect(ticket).toHaveBeenCalledTimes(1)
})

test('手工重连响应迟于新代际事件时不会覆盖 ready', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const reconnection = deferred<RemoteDesktopSession>()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const api = remoteDesktopGateway(session, ticket)
  api.reconnectRemoteDesktopSession = vi.fn(() => reconnection.promise)
  adapterCreate
    .mockResolvedValueOnce(viewerAdapter())
    .mockResolvedValueOnce(viewerAdapter())

  const view = render(
    <RemoteDesktopRuntimeProvider api={api} enabled profiles={[]} initialSessions={[session]}>
      <SessionMutationHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 1))
  fireEvent.click(view.getByTestId('reconnect-session'))
  await waitFor(() => expect(api.reconnectRemoteDesktopSession).toHaveBeenCalledWith(session.id, 1))

  const readyGeneration2: RemoteDesktopSession = {
    ...session,
    connection_generation: 2,
    updated_at: '2026-08-23T12:00:02Z',
  }
  act(() => MockWebSocket.instances[0].emit({ type: 'upsert', session: readyGeneration2 }))
  await waitFor(() => expect(view.getByTestId('session-status')).toHaveTextContent('ready:2'))
  await waitFor(() => expect(ticket).toHaveBeenCalledWith(session.id, 2))

  await act(async () => {
    reconnection.resolve({
      ...session,
      status: 'reconnecting',
      phase: 'dialing_ssh',
      status_message: 'reconnecting',
      updated_at: '2026-08-23T12:00:01Z',
    })
    await reconnection.promise
  })

  expect(view.getByTestId('session-status')).toHaveTextContent('ready:2')
})

test('会话进入最终失败时释放 Viewer 并阻断同 generation 迟到附加', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const adapter = viewerAdapter()
  adapterCreate.mockResolvedValue(adapter)

  render(
    <RemoteDesktopRuntimeProvider
      api={remoteDesktopGateway(session, ticket)}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      status: 'failed',
      phase: 'failed',
      updated_at: '2026-08-23T12:00:03Z',
    },
  }))
  await waitFor(() => expect(adapter.dispose).toHaveBeenCalledTimes(1))

  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: { ...session, updated_at: '2026-08-23T12:00:04Z' },
  }))
  await act(async () => Promise.resolve())
  expect(ticket).toHaveBeenCalledTimes(1)
})

test('同一会话手工重连时保留已确认的完全相同服务器指纹', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const ticket = vi.fn(async (_id: string, generation: number) => ({
    ticket: `ticket-${generation}`,
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: generation,
    stream_path: '/api/v1/remote-desktop-stream',
  }))
  const adapters = [viewerAdapter(), viewerAdapter()]
  const adapterEvents: Array<{
    onServerVerification: (value: { type: string; fingerprint: string }) => void
  }> = []
  adapterCreate.mockImplementation(async (options: { events: typeof adapterEvents[number] }) => {
    adapterEvents.push(options.events)
    return adapters[adapterEvents.length - 1]
  })
  const api = remoteDesktopGateway(session, ticket)
  api.reconnectRemoteDesktopSession = vi.fn(async () => ({
    ...session,
    status: 'reconnecting' as const,
    phase: 'dialing_ssh' as const,
    status_message: 'reconnecting',
  }))

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerControlHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterEvents).toHaveLength(1))
  act(() => adapterEvents[0].onServerVerification({ type: 'RSA', fingerprint: 'SHA256:same' }))
  fireEvent.click(view.getByTestId('approve-server'))
  expect(adapters[0].approveServer).toHaveBeenCalledTimes(1)

  fireEvent.click(view.getByTestId('reconnect-session'))
  await waitFor(() => expect(api.reconnectRemoteDesktopSession).toHaveBeenCalledTimes(1))
  act(() => MockWebSocket.instances[0].emit({
    type: 'upsert',
    session: {
      ...session,
      connection_generation: 2,
      updated_at: '2026-08-23T12:00:05Z',
    },
  }))
  await waitFor(() => expect(adapterEvents).toHaveLength(2))

  await waitFor(() => {
    act(() => adapterEvents[1].onServerVerification({ type: 'RSA', fingerprint: 'SHA256:same' }))
    expect(adapters[1].approveServer).toHaveBeenCalledTimes(1)
  })
})

test('关闭请求失败时保留现有 Viewer 和会话', async () => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  const session = remoteDesktopSession()
  const adapter = viewerAdapter()
  adapterCreate.mockResolvedValue(adapter)
  const api = remoteDesktopGateway(session, vi.fn(async () => ({
    ticket: 'ticket-1',
    credential_ticket: '',
    expires_at: '2026-08-23T12:00:30Z',
    connection_generation: 1,
    stream_path: '/api/v1/remote-desktop-stream',
  })))
  api.deleteRemoteDesktopSession = vi.fn(async () => {
    throw new Error('delete failed')
  })

  const view = render(
    <RemoteDesktopRuntimeProvider
      api={api}
      enabled
      profiles={[]}
      initialSessions={[session]}
    >
      <ViewerControlHarness />
    </RemoteDesktopRuntimeProvider>,
  )

  await waitFor(() => expect(adapterCreate).toHaveBeenCalledTimes(1))
  fireEvent.click(view.getByTestId('close-session'))
  await waitFor(() => expect(api.deleteRemoteDesktopSession).toHaveBeenCalledWith(session.id))

  expect(adapter.dispose).not.toHaveBeenCalled()
  expect(view.getByTestId('close-session')).toBeInTheDocument()
})

function ViewerHarness() {
  const runtime = useRemoteDesktopRuntime()
  const session = runtime.sessions[0]
  return session ? <RemoteDesktopViewport sessionId={session.id} /> : null
}

function MetricsHarness({ sessionId }: { sessionId: string }) {
  const metrics = useRemoteDesktopConnectionMetrics(sessionId)
  return <output data-testid="ssh-rtt">{metrics.sshRttMs ?? '--'}</output>
}

function ViewerControlHarness() {
  const runtime = useRemoteDesktopRuntime()
  const session = runtime.sessions[0]
  if (!session) return null
  return (
    <>
      <RemoteDesktopViewport sessionId={session.id} />
      <button data-testid="approve-server" type="button" onClick={() => runtime.approveServer(session.id)} />
      <button data-testid="reconnect-session" type="button" onClick={() => void runtime.reconnectSession(session.id)} />
      <button data-testid="close-session" type="button" onClick={() => void runtime.closeSession(session.id).catch(() => undefined)} />
      <output data-testid="session-generation">{session.connection_generation}</output>
    </>
  )
}

function ViewerAttachHarness() {
  const runtime = useRemoteDesktopRuntime()
  const session = runtime.sessions[0]
  if (!session) return null
  return (
    <>
      <RemoteDesktopViewport sessionId={session.id} />
      <output data-testid="viewer-error">{runtime.viewerStates[session.id]?.errorCode ?? ''}</output>
    </>
  )
}

function ViewerCredentialHarness() {
  const runtime = useRemoteDesktopRuntime()
  const session = runtime.sessions[0]
  if (!session) return null
  const state = runtime.viewerStates[session.id]
  return (
    <>
      <RemoteDesktopViewport sessionId={session.id} />
      <output data-testid="viewer-credentials">
        {state ? `${state.connection}:${state.credentialFields.length}` : 'missing'}
      </output>
    </>
  )
}

function SessionMutationHarness() {
  const runtime = useRemoteDesktopRuntime()
  const session = runtime.sessions[0]
  return (
    <>
      <button data-testid="create-session" type="button" onClick={() => void runtime.createSession('rdp_test')} />
      {session ? <RemoteDesktopViewport sessionId={session.id} /> : null}
      {session ? (
        <button data-testid="reconnect-session" type="button" onClick={() => void runtime.reconnectSession(session.id)} />
      ) : null}
      <output data-testid="session-status">
        {session ? `${session.status}:${session.connection_generation}` : 'none'}
      </output>
    </>
  )
}

function remoteDesktopGateway(
  session: RemoteDesktopSession,
  createRemoteDesktopAttachTicket: RemoteDesktopGateway['createRemoteDesktopAttachTicket'],
): RemoteDesktopGateway {
  return {
    remoteDesktopProfiles: vi.fn(async () => []),
    createRemoteDesktopProfile: vi.fn(),
    updateRemoteDesktopProfile: vi.fn(),
    deleteRemoteDesktopProfile: vi.fn(),
    saveRemoteDesktopTargetAuth: vi.fn(),
    deleteRemoteDesktopTargetAuth: vi.fn(),
    remoteDesktopSessions: vi.fn(async () => [session]),
    createRemoteDesktopSession: vi.fn(),
    deleteRemoteDesktopSession: vi.fn(async () => undefined),
    reconnectRemoteDesktopSession: vi.fn(),
    createRemoteDesktopAttachTicket,
    consumeRemoteDesktopTargetAuth: vi.fn(async () => ({ password: '' })),
    remoteDesktopSessionEventsUrl: () => 'ws://127.0.0.1:1729/api/v1/remote-desktop-sessions/events',
    remoteDesktopStreamUrl: (value) => `ws://127.0.0.1:1729${value.stream_path}?ticket=${value.ticket}`,
  }
}

function remoteDesktopSession(): RemoteDesktopSession {
  return {
    id: 'rds_test',
    profile_id: 'rdp_test',
    profile_name: 'Test desktop',
    host_id: 'hst_test',
    host_name: 'Test host',
    ssh_profile_id: 'ssh_test',
    route: 'ssh_tunnel',
    route_config_version: 1,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status: 'ready',
    phase: 'ready',
    status_message: 'ready',
    connection_generation: 1,
    viewer_attached: false,
    reconnect_attempt: 0,
    reconnect_max_attempts: 3,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function remoteDesktopProfile(): RemoteDesktopAccessProfile {
  return {
    id: 'rdp_test',
    host_id: 'hst_test',
    name: 'Test desktop',
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_test',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function viewerAdapter() {
  return {
    dispose: vi.fn(),
    setDisplayMode: vi.fn(),
    setViewOnly: vi.fn(),
    setViewportActive: vi.fn(),
    approveServer: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    sendCredentials: vi.fn(),
    sendCtrlAltDel: vi.fn(),
    sendClipboard: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

class MockWebSocket {
  static instances: MockWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  close() {
    this.onclose?.()
  }

  emit(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>)
  }
}
