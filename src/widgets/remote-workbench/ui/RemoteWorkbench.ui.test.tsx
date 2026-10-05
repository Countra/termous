import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { RemoteWorkbench } from './RemoteWorkbench'

vi.mock('./RemoteSessionPanels', () => ({ RemoteSessionPanels: ({ client, selected }: { client: { connection: RemoteConnection }; selected: string }) => <div data-testid="session">{client.connection.id}:{selected}</div> }))

test('断开后在同一窗口重连，保留选中会话且旧回调不能关闭新连接', async () => {
  let id = 'first'
  const connection = () => ({ id, state: 'connected', scope: { generation: '1' }, stats: { path: 'direct', protocol: 'udp', rtt_ms: 1 } }) as RemoteConnection
  const stopped: (() => void)[] = []
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const reconnect = vi.fn(async () => { await gate; id = 'second'; return { ok: true as const, value: connection() } })
  const request = vi.fn(async () => ({ ok: true as const, value: { inventory: { sessions: [{ id: 'ssh', name: 'Existing SSH', kind: 'ssh', generation: '1', state: 'connected' }] } } }))
  const bridge: RemoteWindowBridge = {
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
