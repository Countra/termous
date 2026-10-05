import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { RemoteWorkbench } from './RemoteWorkbench'

vi.mock('./RemoteSessionPanels', () => ({ RemoteSessionPanels: ({ client, selected }: { client: { connection: RemoteConnection }; selected: string }) => <div data-testid="session">{client.connection.id}:{selected}</div> }))

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
  await screen.findByText('Existing SSH')
  fireEvent.click(screen.getByText('Existing SSH'))
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
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled()
  fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]!)
  expect(await screen.findByText('Existing SSH')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test.each([true, false])('较早清单读取的迟到结果不能覆盖较新的清单或提示（失败：%s）', async fail => {
  const connection = { id: 'connection', state: 'connected', scope: { generation: '1' } } as RemoteConnection
  const inventory = (name: string) => ({ ok: true as const, value: { inventory: { sessions: [{ id: 'ssh', name, kind: 'ssh', generation: '1', state: 'connected' }] } } })
  const request = vi.fn<RemoteWindowBridge['request']>().mockResolvedValue(inventory('初始会话'))
  const bridge = { connection: async () => ({ ok: true, value: connection }), request, subscribe: () => () => {}, localTransfers: async () => ({ ok: true, value: [] }) } as unknown as RemoteWindowBridge
  render(<RemoteWorkbench bridge={bridge} bootstrap={{ generation: '1', deviceId: 'host', deviceName: 'Desktop', language: 'zh-CN', theme: 'dark' }} />)
  await screen.findByText('初始会话')
  let finish!: (value: Awaited<ReturnType<RemoteWindowBridge['request']>>) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  request.mockResolvedValue(inventory('最新会话'))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByText('最新会话')
  await act(async () => finish(fail ? { ok: false, code: 'remote_invalid' } : inventory('过期会话')))
  expect(screen.getByText('最新会话')).toBeVisible()
  expect(screen.queryByText('过期会话')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(3)
})
