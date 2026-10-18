import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { RemoteWorkbench } from './RemoteWorkbench'

vi.mock('./RemoteSessionPanels', () => ({ RemoteSessionPanels: ({ client, selected, close }: { client: { connection: RemoteConnection }; selected: string; close(id: string): void }) => <div data-testid="session">{client.connection.id}:{selected}<button onClick={() => close(selected)}>关闭视图</button></div> }))

test.each([true, false, undefined])('AI 入口不依赖本机配置或清单权限标记（%s），首次点击才装配工作区', async agentEnabled => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const bridge: RemoteWindowBridge = {
    agentUpload: vi.fn(), agentDownload: vi.fn(), bootstrap: vi.fn(), reconnect: vi.fn(),
    connection: vi.fn(async () => ({ ok: true as const, value: connection })),
    request: vi.fn(async () => ({ ok: true as const, value: { inventory: { ...(agentEnabled === undefined ? {} : { agentEnabled }), sessions: [] } } })),
    subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }),
    localTransferAction: vi.fn(), selectTransfer: vi.fn(), send: vi.fn(), consume: vi.fn(),
    disconnect: vi.fn(), close: vi.fn(), onAppearance: () => () => {},
  }
  const renderAgent = vi.fn(() => <div>被控端 AI 工作区</div>)
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} renderAgent={renderAgent} />)
  const entry = await screen.findByRole('button', { name: 'AI 助手' })
  await waitFor(() => expect(entry).toBeEnabled())
  expect(renderAgent).not.toHaveBeenCalled()
  fireEvent.click(entry)
  expect(screen.getByText('被控端 AI 工作区')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(2))
  expect(screen.getByText('被控端 AI 工作区')).toBeVisible()
  expect(bridge.connection).toHaveBeenCalledTimes(1)
})

test('断开后在同一窗口重连，保留选中会话且旧回调不能关闭新连接', async () => {
  let id = 'first'
  const connection = () => ({ id, state: 'connected', scope: { generation: '1' }, stats: { path: 'direct', protocol: 'udp', rtt_ms: 1 } }) as RemoteConnection
  const stopped: (() => void)[] = []
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const reconnect = vi.fn(async () => { await gate; id = 'second'; return { ok: true as const, value: connection() } })
  const request = vi.fn(async () => ({ ok: true as const, value: { inventory: { sessions: [{ id: 'ssh', name: 'Existing SSH', kind: 'ssh', generation: '1', state: 'connected' }] } } }))
  const bridge: RemoteWindowBridge = {
    agentUpload: vi.fn(), agentDownload: vi.fn(),
    bootstrap: vi.fn(), connection: async () => ({ ok: true, value: connection() }), reconnect, request,
    subscribe: (_frames, closed) => { stopped.push(closed); return () => {} },
    localTransfers: async () => ({ ok: true, value: [] }),
    localTransferAction: vi.fn(), selectTransfer: vi.fn(), send: vi.fn(), consume: vi.fn(),
    disconnect: vi.fn(), close: vi.fn(), onAppearance: () => () => {},
  }
  const view = render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  await screen.findByRole('button', { name: 'Existing SSH' })
  fireEvent.click(screen.getByRole('button', { name: 'Existing SSH' }))
  expect(screen.getByTestId('session')).toHaveTextContent('first:ssh')
  let rejectOld!: (error: Error) => void
  request.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  act(() => stopped[0]!())
  const retry = screen.getAllByRole('button', { name: '重新连接' })[0]!
  fireEvent.click(retry)
  fireEvent.click(retry)
  await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1))
  await act(async () => { finish() })
  await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('second:ssh'))
  act(() => stopped[0]!())
  await act(async () => { rejectOld(new Error('旧连接读取失败')) })
  expect(screen.getByTestId('session')).toHaveTextContent('second:ssh')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request.mock.calls.every(args => JSON.stringify(args).includes('inventory'))).toBe(true)
  view.unmount()
})

test('首次清单读取失败不误判断连，原地刷新即可恢复', async () => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValueOnce({ ok: false, code: 'remote_invalid' })
    .mockResolvedValue({ ok: true, value: { inventory: { sessions: [{ id: 'ssh', name: 'Existing SSH', kind: 'ssh', generation: '1', state: 'connected' }] } } })
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('heading', { name: '资源加载失败' })).toBeVisible()
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled()
  fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]!)
  expect(await screen.findByRole('button', { name: 'Existing SSH' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test.each([true, false])('较早清单读取的迟到结果不能覆盖较新的清单或提示（失败：%s）', async fail => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const inventory = (name: string) => ({ ok: true as const, value: { inventory: { sessions: [{ id: 'ssh', name, kind: 'ssh', generation: '1', state: 'connected' }] } } })
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue(inventory('初始会话'))
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  await screen.findByRole('button', { name: '初始会话' })
  let finish!: (value: Awaited<ReturnType<RemoteWindowBridge['request']>>) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  request.mockResolvedValue(inventory('最新会话'))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('button', { name: '最新会话' })
  await act(async () => finish(fail ? { ok: false, code: 'remote_invalid' } : inventory('过期会话')))
  expect(screen.getByRole('button', { name: '最新会话' })).toBeVisible()
  expect(screen.queryByText('过期会话')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(3)
})

test.each([true, false])('重连后旧创建及断开回执不能覆盖新连接的状态（断开成功：%s）', async disconnected => {
  let id = 'first'
  const connection = () => ({ id, state: 'connected', scope: { generation: '1' } }) as RemoteConnection
  const stopped: (() => void)[] = []
  const inventory = { hosts: [{ id: 'host', name: '主机', connections: [{ id: 'profile', name: '配置', kind: 'ssh', engine: 'ssh', available: true }] }], sessions: [{ id: 'ssh', name: '已有会话', kind: 'ssh', generation: '1', state: 'connected' }] }
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue({ ok: true, value: { inventory } })
  let finishDisconnect!: (value: Awaited<ReturnType<RemoteWindowBridge['disconnect']>>) => void
  const bridge = {
    connection: async () => ({ ok: true, value: connection() }),
    reconnect: async () => { id = 'second'; return { ok: true, value: connection() } },
    request, subscribe: (_frames: unknown, closed: () => void) => { stopped.push(closed); return () => {} },
    localTransfers: async () => ({ ok: true, value: [] }),
    disconnect: () => new Promise(resolve => { finishDisconnect = resolve }),
  } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  fireEvent.click(await screen.findByRole('button', { name: '已有会话' }))
  let finishOld!: (value: Awaited<ReturnType<RemoteWindowBridge['request']>>) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '打开终端 · 主机 · 配置' }))
  fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
  act(() => stopped[0]!())
  fireEvent.click(screen.getAllByRole('button', { name: '重新连接' })[0]!)
  await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('second:ssh'))
  const create = screen.getByRole('button', { name: '打开终端 · 主机 · 配置' })
  expect(create).toBeEnabled()
  let finishNew!: (value: Awaited<ReturnType<RemoteWindowBridge['request']>>) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  fireEvent.click(create)
  expect(create).toBeDisabled()
  await act(async () => {
    finishOld({ ok: true, value: { session: { id: 'old', kind: 'ssh', generation: '1' } } })
    finishDisconnect(disconnected ? { ok: true, value: true } : { ok: false, code: 'remote_signaling_unavailable' })
  })
  expect(create).toBeDisabled()
  expect(screen.getByTestId('session')).toHaveTextContent('second:ssh')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => finishNew({ ok: true, value: { session: { id: 'new', kind: 'ssh', generation: '1' } } }))
  await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('second:new'))
  expect(create).toBeEnabled()
})

test('连接失败在中央呈现原因，重连成功后清除失败状态', async () => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const reconnect = vi.fn<RemoteWindowBridge['reconnect']>().mockResolvedValue({ ok: true, value: connection })
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue({ ok: true, value: { inventory: { sessions: [] } } })
  const bridge = { connection: async () => ({ ok: false, code: 'remote_signaling_unavailable' }), reconnect, request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  const main = screen.getByRole('main')
  expect(await within(main).findByRole('heading', { name: '连接未成功' })).toBeVisible()
  expect(within(main).getByRole('alert')).toHaveTextContent('远控服务不可达')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(within(main).getByRole('button', { name: '重新连接' }))
  expect(await screen.findByRole('heading', { name: '远程工作台' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(reconnect).toHaveBeenCalledTimes(1)
})

test('已加载清单刷新失败时保留会话，提示内重试恢复后撤回提示', async () => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const value = { inventory: { sessions: [{ id: 'ssh', name: 'Existing SSH', kind: 'ssh', generation: '1', state: 'connected' }] } }
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValueOnce({ ok: true, value }).mockResolvedValueOnce({ ok: false, code: 'remote_invalid' }).mockResolvedValue({ ok: true, value })
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  await screen.findByRole('button', { name: 'Existing SSH' })
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  const feedback = await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Existing SSH' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled()
  fireEvent.click(within(feedback).getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(request).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('button', { name: 'Existing SSH' })).toBeEnabled()
})

test('操作结果未确认以可关闭提示呈现，刷新成功不抹掉结果，也不自动重放操作', async () => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const disconnect = vi.fn<RemoteWindowBridge['disconnect']>().mockResolvedValue({ ok: false, code: 'remote_operation_uncertain', uncertain: true })
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue({ ok: true, value: { inventory: { sessions: [] } } })
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, disconnect, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  const button = screen.getByRole('button', { name: '断开连接' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const feedback = await screen.findByRole('alert')
  expect(feedback).toHaveTextContent('操作结果尚未确认')
  fireEvent.click(within(feedback).getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(feedback).toBeVisible()
  expect(screen.getByRole('heading', { name: '远程工作台' })).toBeVisible()
  fireEvent.click(within(feedback).getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

test('概览继续会话与关闭视图只影响本地视图，不创建或结束远端会话', async () => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue({ ok: true, value: { inventory: {
    sessions: [{ id: 'ssh', name: 'Existing SSH', kind: 'ssh', generation: '1', state: 'connected' }],
  } } })
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  const resume = await screen.findByRole('button', { name: '查看会话 · Existing SSH' })
  await waitFor(() => expect(resume).toBeEnabled())
  fireEvent.click(resume)
  expect(screen.getByTestId('session')).toHaveTextContent('connection:ssh')
  fireEvent.click(screen.getByRole('button', { name: '概览' }))
  expect(screen.getByRole('heading', { name: '远程工作台' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看会话 · Existing SSH' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭视图' }))
  expect(screen.getByRole('heading', { name: '远程工作台' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Existing SSH' })).toBeEnabled()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0]?.[0]).toHaveProperty('inventory')
})
