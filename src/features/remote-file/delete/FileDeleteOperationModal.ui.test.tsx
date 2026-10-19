import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { FileOperationTask } from '#entities/file'
import { TermousApiError } from '#shared/api'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { FileDeleteOperationModal } from './FileDeleteOperationModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const running: FileOperationTask = {
  id: 'delete', revision: 1, file_session_id: 'session', type: 'delete_entries', status: 'running', phase: 'delete', path: '/work',
  total_bytes: 0, transferred_bytes: 0, remaining_bytes: 0, phase_total_bytes: 0, phase_transferred_bytes: 0,
  phase_progress_percent: 0, progress_percent: 0, speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0,
  elapsed_seconds: 0, cancellable: true, created_at: '2026-10-19T00:00:00Z',
}
const result = { items: [], summary: { total: 3, deleted: 3, failed: 0, not_executed: 0, uncertain: 0 }, deleted_items: 3, partial: false, uncertain: false }

function setup() {
  const api = {
    fileOperation: vi.fn().mockResolvedValue(running),
    fileOperationResult: vi.fn().mockResolvedValue(result),
    fileOperationEventsUrl: () => 'ws://127.0.0.1/delete',
    cancelFileOperation: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileOperationGateway
  const onStart = vi.fn().mockResolvedValue(running)
  const onFinished = vi.fn()
  const onClose = vi.fn()
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><FileDeleteOperationModal count={2} api={api} onStart={onStart} onFinished={onFinished} onClose={onClose} /></ConfigProvider>)
  return { api, onStart, onFinished, onClose, view }
}

afterEach(() => { vi.useRealTimers() })

it('等待超过请求期限并恢复查询连接，不重复提交或误报任务失败', async () => {
  vi.useFakeTimers()
  const { api, onStart, onFinished, view } = setup()
  try {
    expect(onStart).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    vi.mocked(api.fileOperation).mockRejectedValue(new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000) })
    expect(screen.getByRole('status')).toHaveTextContent('files.deletion.reconnecting')
    expect(onStart).toHaveBeenCalledOnce()
    expect(onFinished).not.toHaveBeenCalled()
    expect(api.cancelFileOperation).not.toHaveBeenCalled()
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 3, status: 'completed', phase: 'done', progress_percent: 100, cancellable: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(onFinished).toHaveBeenCalledOnce()
    expect(screen.getByText('files.move.feedback.done')).toBeInTheDocument()
    expect(api.fileOperationResult).toHaveBeenCalledWith('delete')
  } finally { view.unmount() }
})

it('取消只请求停止原任务，等待终态后才允许正常关闭', async () => {
  vi.useFakeTimers()
  const { api, onStart, onFinished, view } = setup()
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.cancel' })) })
    expect(api.cancelFileOperation).toHaveBeenCalledWith('delete')
    expect(screen.getByRole('button', { name: 'files.move.close' })).toBeDisabled()
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 3, status: 'cancelled', cancellable: false, partial: true,
      error_code: 'TRANSFER_CANCELLED', error_message: '文件操作已取消' })
    vi.mocked(api.fileOperationResult).mockResolvedValue({ ...result, partial: true, deleted_items: 1,
      summary: { total: 3, deleted: 1, failed: 0, not_executed: 2, uncertain: 0 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(onStart).toHaveBeenCalledOnce()
    expect(onFinished).toHaveBeenCalledOnce()
    expect(screen.getByText('files.move.feedback.cancelled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.move.close' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  } finally { view.unmount() }
})

it('提交结果不确定时禁用重试删除，保持核实提示', async () => {
  const { onStart } = setup()
  onStart.mockRejectedValue(new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0))
  fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))
  await waitFor(() => expect(screen.getByText('files.deletion.submissionUncertain')).toBeVisible())
  expect(screen.getByRole('button', { name: 'app.delete' })).toBeDisabled()
  expect(onStart).toHaveBeenCalledOnce()
})

it('取消请求的迟到错误不覆盖已经完成的删除结果', async () => {
  vi.useFakeTimers()
  const { api, view } = setup()
  let rejectCancel!: (error: Error) => void
  vi.mocked(api.cancelFileOperation).mockImplementation(() => new Promise<void>((_, reject) => { rejectCancel = reject }))
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.delete' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.cancel' })) })
    vi.mocked(api.fileOperation).mockResolvedValue({ ...running, revision: 3, status: 'completed', phase: 'done', cancellable: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    await act(async () => { rejectCancel(new TermousApiError('取消请求超时', 'REQUEST_TIMEOUT', 0)) })
    expect(screen.getByText('files.move.feedback.done')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  } finally { view.unmount() }
})
