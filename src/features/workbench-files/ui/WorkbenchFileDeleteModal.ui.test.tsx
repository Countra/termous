import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { FileOperationTask, FileSession } from '#entities/file'
import type { FileGateway } from '#features/files'
import { WorkbenchFileDeleteModal } from './WorkbenchFileDeleteModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const session: FileSession = {
  id: 'files-1', host_id: 'host-1', origin: 'app', status: 'connected',
  current_path: '/work', connection_generation: 7, started_at: '2026-10-19T00:00:00Z',
}
const running: FileOperationTask = {
  id: 'delete-1', revision: 1, file_session_id: session.id, type: 'delete_entries', status: 'running',
  phase: 'delete', path: '/work/tree', total_bytes: 0, transferred_bytes: 0, remaining_bytes: 0,
  phase_total_bytes: 0, phase_transferred_bytes: 0, phase_progress_percent: 0, progress_percent: 0,
  speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0, elapsed_seconds: 0, cancellable: true,
  created_at: session.started_at,
}

function setup() {
  const api = {
    createFileSessionDeleteOperation: vi.fn().mockResolvedValue(running),
    deleteFileSessionFiles: vi.fn(),
    fileOperation: vi.fn().mockResolvedValue(running),
    fileOperationResult: vi.fn().mockResolvedValue({ items: [], deleted_items: 10, partial: false, uncertain: false }),
    fileOperationEventsUrl: () => 'ws://127.0.0.1/delete',
    cancelFileOperation: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileGateway
  const onRefresh = vi.fn()
  const onClose = vi.fn()
  const target = { fileSessionId: session.id, connectionGeneration: 7, path: '/work/tree' }
  const element = (currentSession: FileSession | null = session, disabled = false) => (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <WorkbenchFileDeleteModal api={api} target={target} currentSession={currentSession} disabled={disabled}
        onClose={onClose} onRefresh={onRefresh} />
    </ConfigProvider>
  )
  const view = render(element())
  return { api, onRefresh, onClose, view, rerender: (currentSession: FileSession | null, disabled = false) => view.rerender(element(currentSession, disabled)) }
}

afterEach(() => { vi.useRealTimers() })

it('工作站确认后创建后台删除任务，长时间运行仍保持进度且不调用同步删除', async () => {
  vi.useFakeTimers()
  const { api, onRefresh, view } = setup()
  try {
    expect(api.createFileSessionDeleteOperation).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000) })
    expect(api.createFileSessionDeleteOperation).toHaveBeenCalledExactlyOnceWith(session.id, 7, ['/work/tree'])
    expect(api.deleteFileSessionFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('files.move.feedback.running')
    expect(onRefresh).not.toHaveBeenCalled()
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 2, status: 'completed', cancellable: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('files.move.feedback.done')
  } finally { view.unmount() }
})

it.each([
  ['切换会话', { ...session, id: 'files-2' }, false],
  ['连接重建', { ...session, connection_generation: 8 }, false],
  ['文件连接断开', { ...session, status: 'disconnected' }, false],
  ['没有文件会话', null, false],
  ['终端正在关闭', session, true],
] as const)('确认前%s时拒绝提交旧目标', async (_, currentSession, disabled) => {
  const { api, rerender } = setup()
  rerender(currentSession, disabled)
  fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('files.connectionRequired'))
  expect(api.createFileSessionDeleteOperation).not.toHaveBeenCalled()
  expect(api.deleteFileSessionFiles).not.toHaveBeenCalled()
})

it.each([
  ['切换会话', { ...session, id: 'files-2' }],
  ['连接重建', { ...session, connection_generation: 8 }],
  ['文件连接断开', null],
] as const)('任务运行中%s后仍可取消，不刷新其他连接', async (_, currentSession) => {
  vi.useFakeTimers()
  const { api, onRefresh, rerender, view } = setup()
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    rerender(currentSession)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.cancel' })) })
    expect(api.cancelFileOperation).toHaveBeenCalledExactlyOnceWith(running.id)
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 2, status: 'cancelled', cancellable: false, partial: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(api.createFileSessionDeleteOperation).toHaveBeenCalledOnce()
    expect(api.fileOperationResult).toHaveBeenCalledWith(running.id)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('files.move.feedback.cancelled')
  } finally { view.unmount() }
})

it.each(['failed', 'cancelled'] as const)('任务%s时也刷新原会话，反映已删除的部分文件', async (status) => {
  const { api, onRefresh } = setup()
  vi.mocked(api.createFileSessionDeleteOperation).mockResolvedValue({ ...running, status, cancellable: false, partial: true })
  fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
  expect(api.createFileSessionDeleteOperation).toHaveBeenCalledOnce()
})

it('提交响应返回前切换会话，继续观察原任务且不刷新新会话', async () => {
  vi.useFakeTimers()
  const { api, onRefresh, rerender, view } = setup()
  let accept!: (task: FileOperationTask) => void
  vi.mocked(api.createFileSessionDeleteOperation).mockImplementation(() => new Promise((resolve) => { accept = resolve }))
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    rerender({ ...session, id: 'files-2' })
    await act(async () => { accept(running) })
    expect(screen.getByRole('status')).toHaveTextContent('files.move.feedback.running')
    expect(api.createFileSessionDeleteOperation).toHaveBeenCalledExactlyOnceWith(session.id, 7, ['/work/tree'])
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 2, status: 'completed', cancellable: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(api.fileOperation).toHaveBeenCalledWith(running.id)
    expect(api.fileOperationResult).toHaveBeenCalledWith(running.id)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(api.cancelFileOperation).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('files.move.feedback.done')
  } finally { view.unmount() }
})

it('观察中断后关闭弹窗只释放观察资源，不取消后台任务或重放删除', async () => {
  vi.useFakeTimers()
  const { api, onClose, view } = setup()
  try {
    vi.mocked(api.fileOperation).mockRejectedValue(new Error('查询暂不可用'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.getByRole('status')).toHaveTextContent('files.deletion.reconnecting')
    const close = screen.getByRole('button', { name: 'files.move.close' })
    expect(close).toBeEnabled()
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    const queryCount = vi.mocked(api.fileOperation).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(api.fileOperation).toHaveBeenCalledTimes(queryCount)
    expect(api.cancelFileOperation).not.toHaveBeenCalled()
    expect(api.createFileSessionDeleteOperation).toHaveBeenCalledOnce()
  } finally { view.unmount() }
})
