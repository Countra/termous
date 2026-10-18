import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { expect, test, vi } from 'vitest'
import type { DesktopExchange, RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { DesktopFilesPanel } from './DesktopFilesPanel'

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

function fixture() {
  return { describe: vi.fn().mockResolvedValue({ capabilities: { directory_mapping: true, exchange: false, file_clipboard: false }, exchanges: [], mappings: [] }), retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]), cancelTask: vi.fn() } as unknown as DesktopFilesGateway
}

test('文件侧栏保留窗口级 Portal 和遮罩，关闭重开不丢失状态或重复挂载', async () => {
  const api = fixture()
  const close = vi.fn()
  const tree = (open: boolean) => <ConfigProvider theme={{ token: { motion: false } }}><App>
    <header data-testid="window-chrome">窗口拖动区</header>
    <section data-testid="desktop-workspace" style={{ position: 'relative', height: 600 }}>
      <DesktopFilesPanel open={open} api={api} onClose={close} />
    </section>
  </App></ConfigProvider>
  const view = render(tree(true))
  await screen.findByText('remoteDesktop.files.retainedEmpty')
  const dialog = screen.getByRole('dialog')
  const drawer = dialog.closest('.ant-drawer')!
  const workspace = screen.getByTestId('desktop-workspace')
  expect(workspace).not.toContainElement(drawer as HTMLElement)
  expect(document.body).toContainElement(drawer as HTMLElement)
  expect(drawer).not.toHaveClass('ant-drawer-inline')
  expect(drawer.querySelector('.ant-drawer-mask')).toBeInTheDocument()
  expect(drawer).not.toContainElement(screen.getByTestId('window-chrome'))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.taskTitle' }))
  fireEvent.click(drawer.querySelector('.ant-drawer-mask')!)
  expect(close).toHaveBeenCalledOnce()
  view.rerender(tree(false))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(tree(true))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.taskTitle' })).toHaveAttribute('aria-pressed', 'true')
  expect(document.querySelectorAll('.ant-drawer')).toHaveLength(1)
})

test('没有 RDP 会话时展示留存文件，关闭文件页不取消后台任务', async () => {
  const api = fixture()
  const close = vi.fn()
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><DesktopFilesPanel api={api} onClose={close} /></App></ConfigProvider>)
  expect(await screen.findByText('remoteDesktop.files.retainedEmpty')).toBeVisible()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.exchange' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.mappings' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.clipboard' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  expect(close).toHaveBeenCalledOnce()
  expect(api.cancelTask).not.toHaveBeenCalled()
  expect(api.describe).not.toHaveBeenCalled()
})

test('仅支持目录共享时仍能进入共享页，不误报所有文件能力不可用', async () => {
  const api = fixture()
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><DesktopFilesPanel api={api} session={{ id: 'rdp', protocol: 'rdp', connection_generation: 2 } as RemoteDesktopSession} onClose={vi.fn()} /></App></ConfigProvider>)
  await screen.findByRole('button', { name: 'remoteDesktop.files.openExchange' })
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.mappings' }))
  expect(await screen.findByText('remoteDesktop.files.mappingEmpty')).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: 'remoteDesktop.files.addMapping' })).toBeEnabled())
  expect(screen.queryByText('remoteDesktop.files.errors.desktop_files_unsupported')).not.toBeInTheDocument()
})

test('文件侧栏关闭后记住页签，暂停查询，连接换代后隔离旧状态', async () => {
  vi.useFakeTimers()
  try {
    const api = fixture()
    const session = { id: 'rdp', protocol: 'rdp', connection_generation: 2 } as RemoteDesktopSession
    const tree = (open: boolean, current = session) => <ConfigProvider theme={{ token: { motion: false } }}><App>
      <DesktopFilesPanel key={`${current.id}:${current.connection_generation}`} open={open} api={api} session={current} onClose={vi.fn()} />
    </App></ConfigProvider>
    const view = render(tree(false))
    await act(async () => {})
    expect(api.describe).not.toHaveBeenCalled()
    await act(async () => { view.rerender(tree(true)) })
    fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.mappings' }))
    expect(screen.getByText('remoteDesktop.files.mappingEmpty')).toBeVisible()
    const signal = vi.mocked(api.describe).mock.calls[0]![2]!
    await act(async () => { view.rerender(tree(false)) })
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(api.describe).toHaveBeenCalledTimes(1)
    await act(async () => { view.rerender(tree(true)) })
    expect(screen.getByRole('button', { name: 'remoteDesktop.files.mappings' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('remoteDesktop.files.mappingEmpty')).toBeVisible()
    expect(api.describe).toHaveBeenCalledTimes(2)
    await act(async () => { view.rerender(tree(false, { ...session, connection_generation: 3 })) })
    await act(async () => { view.rerender(tree(true, { ...session, connection_generation: 3 })) })
    expect(screen.getByRole('button', { name: 'remoteDesktop.files.exchange' })).toHaveAttribute('aria-pressed', 'true')
    expect(api.describe).toHaveBeenLastCalledWith('rdp', 3, expect.any(AbortSignal))
    view.unmount()
  } finally { vi.useRealTimers() }
})

test('再次打开保留目录、搜索和有效选择，后台刷新移除的文件不能继续保存', async () => {
  const api = fixture()
  const exchange: DesktopExchange = { id: 'exchange', session_id: 'rdp', kind: 'exchange', state: 'active', resource_generation: 1, name: '交换区', created_at: '' }
  vi.mocked(api.describe).mockResolvedValue({ capabilities: { directory_mapping: true, exchange: true, file_clipboard: false }, mappings: [], exchanges: [exchange] })
  api.entries = vi.fn().mockResolvedValueOnce([{ path: '/文档', name: '文档', kind: 'directory', size: 0 }])
    .mockResolvedValue([{ path: '/文档/说明.txt', name: '说明.txt', kind: 'file', size: 12 }])
  const session = { id: 'rdp', protocol: 'rdp', connection_generation: 2 } as RemoteDesktopSession
  const tree = (open: boolean) => <ConfigProvider theme={{ token: { motion: false } }}><App>
    <DesktopFilesPanel open={open} api={api} session={session} onClose={vi.fn()} />
  </App></ConfigProvider>
  const view = render(tree(true))
  fireEvent.click(await screen.findByRole('button', { name: '文档' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'remoteDesktop.files.select' }))
  const search = screen.getByRole('textbox', { name: 'remoteDesktop.files.search' })
  fireEvent.change(search, { target: { value: '说明' } })
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.saveSelected' })).toBeEnabled()
  await act(async () => { view.rerender(tree(false)) })
  let finish!: (value: Awaited<ReturnType<DesktopFilesGateway['entries']>>) => void
  vi.mocked(api.entries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view.rerender(tree(true)) })
  expect(screen.getByRole('textbox', { name: 'remoteDesktop.files.search' })).toHaveValue('说明')
  expect(screen.getByRole('button', { name: '说明.txt' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'remoteDesktop.files.select' })).toBeChecked()
  expect(api.entries).toHaveBeenLastCalledWith({ id: 'exchange', resource_generation: 1 }, '/文档', false, expect.any(AbortSignal))
  await act(async () => { finish([]) })
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.saveSelected' })).toBeDisabled()
})
