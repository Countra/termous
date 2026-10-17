import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { TransferTask } from '#entities/file'
import type { DesktopExchange, DesktopFileEntry } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import type { useDesktopFiles } from '../../model/useDesktopFiles.ts'
import { DesktopExchangeBrowser } from './DesktopExchangeBrowser.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { name?: string }) => args?.name ? `${key}:${args.name}` : key }) }))

const exchange: DesktopExchange = { id: 'exchange', kind: 'exchange', session_id: 'session', resource_generation: 2, state: 'active', name: '交换区', created_at: '' }
const folder: DesktopFileEntry = { name: '子目录', path: '/子目录', kind: 'directory', size: 0, version: 'v1', modified_at: '' }
const file: DesktopFileEntry = { name: '原目录.txt', path: '/原目录.txt', kind: 'file', size: 1, version: 'v2', modified_at: '' }

function fixture(entries: DesktopFilesGateway['entries']) {
  const api = { entries, transfer: vi.fn(), mutate: vi.fn() } as unknown as DesktopFilesGateway
  const operations = { busy: false, tasks: [], run: vi.fn(), withGrant: vi.fn() } as unknown as ReturnType<typeof useDesktopFiles>
  return { api, exchange, operations, overwrite: 'rename' as const }
}

test('切换目录时立即失效旧选择，加载失败不能继续下载旧目录条目', async () => {
  let reject!: (error: Error) => void
  const entries = vi.fn<DesktopFilesGateway['entries']>().mockResolvedValueOnce([folder, file])
    .mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const props = fixture(entries)
  render(<App><DesktopExchangeBrowser {...props} /></App>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'remoteDesktop.files.select:原目录.txt' }))
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.saveSelected' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '子目录' }))
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.saveSelected' })).toBeDisabled()
  expect(screen.queryByText('原目录.txt')).not.toBeInTheDocument()
  await act(async () => { reject(new Error('读取失败')) })
  expect(await screen.findByText('remoteDesktop.files.readFailed')).toBeVisible()
  expect(screen.getByRole('button', { name: 'remoteDesktop.files.saveSelected' })).toBeDisabled()
  expect(props.api.transfer).not.toHaveBeenCalled()
})

test('同交换区任务结束自动刷新目录，其他交换区和进行中的进度不触发重读', async () => {
  const entries = vi.fn<DesktopFilesGateway['entries']>().mockResolvedValue([folder])
  const props = fixture(entries)
  const view = render(<App><DesktopExchangeBrowser {...props} /></App>)
  await screen.findByRole('button', { name: '子目录' })
  const task = { id: 'upload', desktop_exchange_id: exchange.id, desktop_resource_generation: 2, status: 'running' } as TransferTask
  const update = (tasks: TransferTask[]) => view.rerender(<App><DesktopExchangeBrowser {...props} operations={{ ...props.operations, tasks }} /></App>)
  update([task, { ...task, id: 'other', desktop_exchange_id: 'other', status: 'completed' }])
  expect(entries).toHaveBeenCalledTimes(1)
  entries.mockResolvedValue([folder, file])
  update([{ ...task, status: 'completed' }])
  expect(await screen.findByText('原目录.txt')).toBeVisible()
  expect(entries).toHaveBeenCalledTimes(2)
  update([{ ...task, status: 'completed' }])
  await waitFor(() => expect(entries).toHaveBeenCalledTimes(2))
})

test('文件名在对话框内校验，空白包裹的上级路径不能提交', async () => {
  const entries = vi.fn<DesktopFilesGateway['entries']>().mockResolvedValue([])
  const props = fixture(entries)
  vi.mocked(props.operations.run).mockImplementation(async action => { await action(); return true })
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><DesktopExchangeBrowser {...props} /></App></ConfigProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'remoteDesktop.files.newFolder' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.newFolder' }))
  const name = await screen.findByRole('textbox', { name: 'remoteDesktop.files.name' })
  fireEvent.change(name, { target: { value: ' .. ' } })
  fireEvent.click(screen.getByRole('button', { name: 'app.confirm' }))
  await waitFor(() => expect(screen.getByText('remoteDesktop.files.invalidName')).toBeVisible())
  expect(props.api.mutate).not.toHaveBeenCalled()
  fireEvent.change(name, { target: { value: '新目录' } })
  fireEvent.click(screen.getByRole('button', { name: 'app.confirm' }))
  await waitFor(() => expect(props.api.mutate).toHaveBeenCalledWith(exchange, 'mkdir', '/新目录', undefined, ''))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('上传菜单仅在选择文件夹后申请目录授权，沿用当前路径和同名策略', async () => {
  const user = userEvent.setup()
  const props = fixture(vi.fn<DesktopFilesGateway['entries']>().mockResolvedValue([]))
  vi.mocked(props.operations.run).mockImplementation(async action => { await action(); return true })
  vi.mocked(props.operations.withGrant).mockImplementation(async (_mode, _multiple, action) => { await action('directory-grant') })
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><DesktopExchangeBrowser {...props} overwrite="skip" /></App></ConfigProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'remoteDesktop.files.uploadOptions' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'remoteDesktop.files.uploadOptions' }))
  expect(props.operations.withGrant).not.toHaveBeenCalled()
  await user.click(await screen.findByRole('menuitem', { name: 'remoteDesktop.files.uploadFolder' }))
  expect(props.operations.withGrant).toHaveBeenCalledWith('directories', true, expect.any(Function))
  expect(props.api.transfer).toHaveBeenCalledWith(exchange, 'upload', 'directory-grant', [], '/', 'skip')
})
