import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DesktopFileClipboard as ClipboardState, RemoteDesktopSession } from '#entities/remote-desktop'
import { rememberDesktopClipboardSelection, type DesktopFilesGateway, type RemoteDesktopViewerState } from '#features/remote-desktop'
import type { useDesktopFiles } from '../../model/useDesktopFiles.ts'
import { DesktopFileClipboard } from './DesktopFileClipboard.tsx'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const session = { id: 'rdp-files', connection_generation: 3 } as RemoteDesktopSession
const viewer = { connection: 'connected', viewOnly: false, controlOwned: true, controlLease: { id: 'viewer', generation: 4 } } as RemoteDesktopViewerState
const state: ClipboardState = { available: true, published: true, serving: false, provided_bytes: 0, huge_files: true, locking: true, offered: false, content_generation: 8, files: [], total_files: 0 }

function props(clipboard: DesktopFilesGateway['clipboard']) {
  return {
    api: { clipboard } as DesktopFilesGateway, session, viewer,
    operations: { tasks: [], busy: false, run: vi.fn(), withGrant: vi.fn() } as unknown as ReturnType<typeof useDesktopFiles>,
    overwrite: 'rename' as const,
  }
}

test('文件清单发布后显示等待粘贴，关闭面板取消状态查询', async () => {
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state)
  const view = render(<DesktopFileClipboard {...props(clipboard)} />)
  expect(await screen.findByText('remoteDesktop.files.clipboardWaiting')).toBeVisible()
  expect(screen.queryByText('remoteDesktop.files.clipboardServing')).not.toBeInTheDocument()
  expect(clipboard).toHaveBeenCalledWith(session.id, { generation: 3, subscription_id: 'viewer', control_generation: 4, content_generation: 0 }, expect.any(AbortSignal))
  view.unmount()
  expect(clipboard.mock.calls[0]![2]!.aborted).toBe(true)
})

test('等值控制租约不重启查询，租约更换时取消旧请求并忽略迟到结果', async () => {
  let finish!: (value: ClipboardState) => void
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>()
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue({ ...state, published: false })
  const input = props(clipboard)
  const view = render(<DesktopFileClipboard {...input} />)
  const signal = clipboard.mock.calls[0]![2]!
  await act(async () => { view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlLease: { ...viewer.controlLease! } }} />) })
  expect(signal.aborted).toBe(false)
  expect(clipboard).toHaveBeenCalledOnce()
  await act(async () => { view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlLease: { id: 'new-viewer', generation: 5 } }} />) })
  expect(signal.aborted).toBe(true)
  expect(clipboard).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ subscription_id: 'new-viewer', control_generation: 5 }), expect.any(AbortSignal))
  await act(async () => { finish(state) })
  expect(screen.queryByText('remoteDesktop.files.clipboardWaiting')).not.toBeInTheDocument()
})

test('实际提供正文时展示供给状态，不根据准备任务完成推断目标落盘', async () => {
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue({ ...state, serving: true, provided_bytes: 4096 })
  render(<DesktopFileClipboard {...props(clipboard)} />)
  expect(await screen.findByText('remoteDesktop.files.clipboardServing')).toBeVisible()
  expect(screen.getByText('remoteDesktop.files.clipboardProvided')).toBeVisible()
  expect(screen.queryByText('remoteDesktop.files.clipboardWaiting')).not.toBeInTheDocument()
})

test('控制权丢失立即禁用所有操作，迟到的发布响应不恢复入口', async () => {
  let resolve!: (value: ClipboardState) => void
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockReturnValue(new Promise(done => { resolve = done }))
  const input = props(clipboard)
  const view = render(<DesktopFileClipboard {...input} />)
  view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlOwned: false }} />)
  await act(async () => { resolve(state) })
  for (const action of ['publish', 'publishFolder', 'revoke']) {
    expect(screen.getByRole('button', { name: `remoteDesktop.files.${action}` })).toBeDisabled()
  }
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.readClipboard' })).toBeDisabled()
  expect(clipboard.mock.calls[0]![2]!.aborted).toBe(true)
  expect(screen.queryByText('remoteDesktop.files.clipboardWaiting')).not.toBeInTheDocument()
})

test('目标内容换代后停用旧清单，不能继续提交接收', async () => {
  let latest = { ...state, files: [{ index: 0, name: '目标文件.txt', directory: false, size: 4 }], total_files: 1 }
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockImplementation(async () => latest)
  const input = props(clipboard)
  input.api.requestClipboard = vi.fn().mockResolvedValue({ id: 'list', state: 'completed', completed_bytes: 0, completed_files: 0 })
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.readClipboard' }))
  await screen.findByRole('button', { name: '目标文件.txt' })
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.receive' })).toBeEnabled()
  latest = { ...latest, content_generation: 9 }
  await waitFor(() => expect(screen.getByText('remoteDesktop.files.clipboardChanged')).toBeVisible(), { timeout: 2500 })
  expect(screen.queryByRole('button', { name: '目标文件.txt' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.receive' })).toBeDisabled()
})

test('切换传输方向保留已读取的文件选择，保存仍使用目录授权与原内容代次', async () => {
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue({ ...state, files: [{ index: 0, name: '资料.txt', directory: false, size: 4 }], total_files: 1 })
  const input = props(clipboard)
  input.api.requestClipboard = vi.fn().mockResolvedValue({ id: 'list', state: 'completed' })
  input.api.transferClipboard = vi.fn()
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  vi.mocked(input.operations.withGrant).mockImplementation(async (_mode, _multiple, action) => { await action('save-folder', []) })
  render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.readClipboard' }))
  await screen.findByRole('button', { name: '资料.txt' })
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.sendToDesktop' }))
  expect(screen.queryByRole('button', { name: '资料.txt' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  expect(screen.getByRole('button', { name: '资料.txt' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receive' }))
  expect(input.operations.withGrant).toHaveBeenCalledWith('directories', false, expect.any(Function))
  expect(input.api.transferClipboard).toHaveBeenCalledWith(session.id, expect.objectContaining({ generation: 3, control_generation: 4, content_generation: 8 }), 'receive', 'save-folder', [0], 'rename')
})

test('读取期间丢失控制权，迟到的剪贴板状态不能继续请求文件清单', async () => {
  let resolve!: (value: ClipboardState) => void
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValueOnce(state)
    .mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const input = props(clipboard)
  input.api.requestClipboard = vi.fn()
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  const view = render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.readClipboard' }))
  view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlOwned: false }} />)
  await act(async () => { resolve(state) })
  expect(input.api.requestClipboard).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.readClipboard' })).toBeDisabled()
})

test('本机选文件期间丢失控制权，授权返回后不会发送旧会话操作', async () => {
  let finish!: () => Promise<void>
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state))
  input.api.transferClipboard = vi.fn()
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  vi.mocked(input.operations.withGrant).mockImplementation((_mode, _multiple, action) => new Promise(resolve => {
    finish = async () => { await action('chosen-files', []); resolve() }
  }))
  const view = render(<DesktopFileClipboard {...input} />)
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.publish' }))
  view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlOwned: false }} />)
  await act(async () => { await finish() })
  expect(input.api.transferClipboard).not.toHaveBeenCalled()
})

const selectionContext = { sessionId: session.id, generation: 3, subscriptionId: 'viewer', controlGeneration: 4 }
const chosen = [{ id: 'file', name: '交付说明.txt', kind: 'file' as const, size: 2048 }, { id: 'folder', name: '项目文档', kind: 'directory' as const }]

test('发送清单展示文件名称、类型与大小，切换方向后仍保留，撤销发布后隐藏', async () => {
  let latest = state
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockImplementation(async () => latest)
  render(<DesktopFileClipboard {...props(clipboard)} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  const list = screen.getByRole('list', { name: 'remoteDesktop.files.sendSelection' })
  expect(list).toHaveTextContent('交付说明.txt')
  expect(list).toHaveTextContent('2.0 KB')
  expect(list).toHaveTextContent('remoteDesktop.files.folder')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  expect(screen.queryByRole('list', { name: 'remoteDesktop.files.sendSelection' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.sendToDesktop' }))
  expect(screen.getByText('交付说明.txt')).toBeVisible()
  latest = { ...state, published: false }
  await waitFor(() => expect(screen.queryByRole('list', { name: 'remoteDesktop.files.sendSelection' })).not.toBeInTheDocument(), { timeout: 2500 })
})

test('手动选择文件也记录清单，仅将展示元数据交给当前控制会话', async () => {
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state))
  input.api.transferClipboard = vi.fn().mockResolvedValue({ id: 'manual-task', status: 'completed' })
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  vi.mocked(input.operations.withGrant).mockImplementation(async (_mode, _multiple, action) => { await action('selected-grant', chosen) })
  render(<DesktopFileClipboard {...input} />)
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.publish' }))
  expect(await screen.findByText('交付说明.txt')).toBeVisible()
  expect(input.api.transferClipboard).toHaveBeenCalledWith(session.id, expect.objectContaining({ generation: 3 }), 'publish', 'selected-grant', [], 'rename')
})

test('文件夹入口使用原目录授权流程，更换清单后不沿用原文件的展开状态', async () => {
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state))
  input.api.transferClipboard = vi.fn().mockResolvedValue({ id: 'folder-task', status: 'completed' })
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  vi.mocked(input.operations.withGrant).mockImplementation(async (_mode, _multiple, action) => { await action('folder-grant', chosen) })
  render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.publishFolder' }))
  expect(input.operations.withGrant).toHaveBeenCalledWith('directories', true, expect.any(Function))
  const file = await screen.findByRole('button', { name: '交付说明.txt' })
  fireEvent.click(file)
  expect(file).toHaveAttribute('aria-expanded', 'true')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'replacement-task', chosen))
  expect(screen.getByRole('button', { name: '交付说明.txt' })).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.publish' }))
  expect(input.operations.withGrant).toHaveBeenLastCalledWith('files', true, expect.any(Function))
  await act(async () => {})
})

test('准备中展示清单，任务失败及控制租约换代后隐藏，不展示旧文件', async () => {
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state))
  input.operations.tasks = [{ id: 'send-task', desktop_session_id: session.id, status: 'running', total_bytes: 4096 }] as typeof input.operations.tasks
  const view = render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  expect(screen.getByText('remoteDesktop.files.clipboardPreparing')).toBeVisible()
  expect(screen.getByText('交付说明.txt')).toBeVisible()
  view.rerender(<DesktopFileClipboard {...input} operations={{ ...input.operations, tasks: [{ ...input.operations.tasks[0]!, status: 'failed' }] }} />)
  expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
  view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlLease: { id: 'other', generation: 5 } }} />)
  expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
})

test('停止提供后，其他文件操作的忙碌状态不会让旧清单重新出现', async () => {
  let latest = state
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockImplementation(async () => latest))
  const view = render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  expect(screen.getByText('交付说明.txt')).toBeVisible()
  latest = { ...state, published: false }
  await waitFor(() => expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument(), { timeout: 2500 })
  view.rerender(<DesktopFileClipboard {...input} operations={{ ...input.operations, busy: true }} />)
  expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
})

test('停止提供成功立即清除清单，迟到的旧发布状态不会恢复已撤销文件', async () => {
  let finish!: (value: ClipboardState) => void
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValueOnce(state)
    .mockImplementation(() => new Promise(resolve => { finish = resolve })))
  input.api.requestClipboard = vi.fn().mockResolvedValue({ id: 'revoke', state: 'completed' })
  vi.mocked(input.operations.run).mockImplementation(async action => { await action(); return true })
  render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  await waitFor(() => expect(finish).toBeDefined(), { timeout: 2500 })
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.revoke' }))
  await waitFor(() => expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument())
  await act(async () => { finish(state) })
  expect(screen.getByText('remoteDesktop.files.publicationIdle')).toBeVisible()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.revoke' })).toBeDisabled()
})

test.each(['completed', 'failed'] as const)('停止提供等待远程操作确认，%s 时分别清理或保留清单', async status => {
  let finish!: (value: ClipboardState) => void
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockImplementation(async (_id, query) => query.operation_id
    ? new Promise(resolve => { finish = resolve }) : state))
  input.api.requestClipboard = vi.fn().mockResolvedValue({ id: 'revoke', state: 'running' })
  const errors: unknown[] = []
  vi.mocked(input.operations.run).mockImplementation(async action => {
    try { await action(); return true } catch (error) { errors.push(error); return false }
  })
  render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.revoke' }))
  await waitFor(() => expect(finish).toBeDefined())
  expect(screen.getByText('交付说明.txt')).toBeVisible()
  await act(async () => { finish({ ...state, operation: { id: 'revoke', state: status, error_code: 'rdp_file_clipboard_failed', completed_bytes: 0, completed_files: 0 } }) })
  if (status === 'completed') {
    expect(errors).toHaveLength(0)
    expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
  } else {
    expect(errors).toEqual([new Error('rdp_file_clipboard_failed')])
    expect(screen.getByText('交付说明.txt')).toBeVisible()
  }
})

test.each(['failed', 'cancelled'] as const)('发送任务 %s 后清除元数据，删除任务记录也不会恢复旧清单', async status => {
  const input = props(vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state))
  const view = render(<DesktopFileClipboard {...input} />)
  await screen.findByText('remoteDesktop.files.clipboardWaiting')
  act(() => rememberDesktopClipboardSelection(selectionContext, 'send-task', chosen))
  expect(screen.getByText('交付说明.txt')).toBeVisible()
  view.rerender(<DesktopFileClipboard {...input} operations={{ ...input.operations, tasks: [{ id: 'send-task', desktop_session_id: session.id, status }] as typeof input.operations.tasks }} />)
  expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
  view.rerender(<DesktopFileClipboard {...input} />)
  expect(screen.queryByText('交付说明.txt')).not.toBeInTheDocument()
})
