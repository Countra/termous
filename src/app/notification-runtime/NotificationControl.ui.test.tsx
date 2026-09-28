import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import type { NotificationBridge, NotificationMessage, NotificationTarget } from '#common/contracts'
import { NotificationControl } from './NotificationControl'

const desktop = vi.hoisted(() => ({ bridge: null as NotificationBridge | null, centreRenders: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => desktop.bridge ? { notifications: desktop.bridge } : undefined }))
vi.mock('#widgets/notification-center', () => ({ NotificationCenter: (props: {
  open: boolean; filter: string; unavailable: boolean; selected: NotificationMessage | null; onReadAll(): void
}) => {
  desktop.centreRenders(props.open)
  return <div><button onClick={props.onReadAll}>read-all</button><output data-testid="centre">{props.open ? props.filter : 'closed'}</output><output data-testid="result">{props.open && props.unavailable ? props.selected?.source_id : ''}</output></div>
} }))

class Socket {
  static current: Socket
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  constructor() { Socket.current = this }
  close() {}
}
const message: NotificationMessage = { id: 'one', sequence: 12, kind: 'agent', outcome: 'success', source_id: 'run', session_id: 'session', operation: 'run', occurred_at: new Date().toISOString(), completed_files: 0, total_files: 0, skipped_items: 0, native_eligible: true, read: false }
function api() { return { eventsUrl: () => 'ws://127.0.0.1/fixture', read: vi.fn<(input: { ids: string[] } | { watermark: number }) => Promise<void>>(async () => {}), dismiss: vi.fn(async () => {}) } }
beforeEach(() => { desktop.bridge = null; desktop.centreRenders.mockClear(); vi.stubGlobal('WebSocket', Socket) })
afterEach(() => vi.unstubAllGlobals())

test.each(['agent', 'file', 'approval'] as const)('点击 %s 系统消息在异步定位前后都不打开消息中心', async (kind) => {
  const gateway = api()
  const item: NotificationMessage = { ...message, kind, outcome: kind === 'approval' ? 'attention' : 'success', operation: kind === 'agent' ? 'run' : kind === 'file' ? 'upload_file' : 'command', ...(kind === 'approval' ? { expires_at: new Date(Date.now() + 60_000).toISOString() } : {}) }
  const target: NotificationTarget = kind === 'agent' ? { kind: 'agent', session_id: 'session' }
    : kind === 'file' ? { kind: 'transfer', transfer_id: 'run' } : { kind: 'approval', approval_id: 'run' }
  let resolveNavigation!: (found: boolean) => void
  const navigation = new Promise<boolean>((resolve) => { resolveNavigation = resolve })
  const navigate = vi.fn(() => navigation)
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'direct', target, messages: [item] }]), acknowledge: vi.fn(async () => {}), onActivation: vi.fn(() => () => {}) }
  render(<NotificationControl api={gateway} enabled navigate={navigate} />)
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(target))
  expect(screen.getByTestId('centre')).toHaveTextContent('closed')
  expect(gateway.read).not.toHaveBeenCalled()
  await act(async () => resolveNavigation(true))
  await waitFor(() => expect(desktop.bridge!.acknowledge).toHaveBeenCalledWith('direct'))
  expect(gateway.read).toHaveBeenCalledWith({ ids: ['one'] })
  expect(desktop.centreRenders.mock.calls.every(([open]) => open === false)).toBe(true)
})

test('合并通知直接打开消息分组，不尝试定位某个单独任务', async () => {
  const gateway = api()
  const messages: NotificationMessage[] = [{ ...message, kind: 'file' }, { ...message, id: 'two', kind: 'file' }]
  const navigate = vi.fn(async () => true)
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'group', target: { kind: 'centre' as const, filter: 'file' as const }, messages }]), acknowledge: vi.fn(async () => {}), onActivation: vi.fn(() => () => {}) }
  render(<NotificationControl api={gateway} enabled navigate={navigate} />)
  await waitFor(() => expect(desktop.bridge!.acknowledge).toHaveBeenCalledWith('group'))
  expect(screen.getByTestId('centre')).toHaveTextContent('file')
  expect(gateway.read).toHaveBeenCalledWith({ ids: ['one', 'two'] })
  expect(navigate).not.toHaveBeenCalled()
})

test('Renderer 就绪后消费暂存激活，已读落库成功之前不确认消费', async () => {
  const gateway = api()
  let resolve!: () => void
  gateway.read.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'activation', target: { kind: 'agent' as const, session_id: 'session' }, messages: [message] }]), acknowledge: vi.fn(async () => {}), onActivation: vi.fn(() => () => {}) }
  const navigate = vi.fn(async () => true)
  const view = render(<NotificationControl api={gateway} enabled={false} navigate={navigate} />)
  expect(desktop.bridge.pending).not.toHaveBeenCalled()
  view.rerender(<NotificationControl api={gateway} enabled navigate={navigate} />)
  await waitFor(() => expect(gateway.read).toHaveBeenCalledWith({ ids: ['one'] }))
  expect(navigate).toHaveBeenCalledWith({ kind: 'agent', session_id: 'session' })
  expect(desktop.bridge.acknowledge).not.toHaveBeenCalled()
  await act(async () => resolve())
  await waitFor(() => expect(desktop.bridge!.acknowledge).toHaveBeenCalledWith('activation'))
})

test('失效目标保留摘要，不能启动或重试原任务', async () => {
  const gateway = api()
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'deleted', target: { kind: 'agent' as const, session_id: 'session' }, messages: [message] }]), acknowledge: vi.fn(async () => {}), onActivation: vi.fn(() => () => {}) }
  render(<NotificationControl api={gateway} enabled navigate={async () => false} />)
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('run'))
  expect(gateway.read).toHaveBeenCalledWith({ ids: ['one'] })
})

test.each(['read', 'acknowledge'] as const)('跳转后的 %s 失败不弹开抽屉，重试交接不重复跳转', async (operation) => {
  const gateway = api()
  const acknowledge = vi.fn(async () => {})
  const failure = new Error('fixture unavailable')
  if (operation === 'read') gateway.read.mockRejectedValueOnce(failure)
  else acknowledge.mockRejectedValueOnce(failure)
  let activate!: () => void
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'retry', target: { kind: 'agent' as const, session_id: 'session' }, messages: [message] }]), acknowledge, onActivation: vi.fn((callback) => { activate = callback; return () => {} }) }
  const navigate = vi.fn(async () => true)
  render(<NotificationControl api={gateway} enabled navigate={navigate} />)
  await waitFor(() => expect(operation === 'read' ? gateway.read : acknowledge).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('centre')).toHaveTextContent('closed')
  await act(async () => activate())
  await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(operation === 'read' ? 1 : 2))
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(desktop.centreRenders.mock.calls.every(([open]) => open === false)).toBe(true)
})

test('停用后的异步定位结果不再打开抽屉、写已读或确认激活', async () => {
  const gateway = api()
  let resolve!: (found: boolean) => void
  const navigate = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
  desktop.bridge = { pending: vi.fn(async () => [{ id: 'stale', target: { kind: 'agent' as const, session_id: 'session' }, messages: [message] }]), acknowledge: vi.fn(async () => {}), onActivation: vi.fn(() => () => {}) }
  const rendered = render(<NotificationControl api={gateway} enabled navigate={navigate} />)
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
  rendered.rerender(<NotificationControl api={gateway} enabled={false} navigate={navigate} />)
  await act(async () => resolve(false))
  expect(gateway.read).not.toHaveBeenCalled()
  expect(desktop.bridge.acknowledge).not.toHaveBeenCalled()
  expect(desktop.centreRenders.mock.calls.every(([open]) => open === false)).toBe(true)
})

test('批量已读固定点击时水位，不扩展到后到的消息', async () => {
  const gateway = api()
  render(<NotificationControl api={gateway} enabled navigate={async () => false} />)
  act(() => Socket.current.onmessage?.({ data: JSON.stringify({ type: 'snapshot', page: { items: [message], watermark: 12, unread_count: 1, next_before: 0 } }) }))
  fireEvent.click(screen.getByRole('button', { name: 'read-all' }))
  act(() => Socket.current.onmessage?.({ data: JSON.stringify({ type: 'upsert', message: { ...message, id: 'new', sequence: 13 } }) }))
  await waitFor(() => expect(gateway.read).toHaveBeenCalledExactlyOnceWith({ watermark: 12 }))
})
