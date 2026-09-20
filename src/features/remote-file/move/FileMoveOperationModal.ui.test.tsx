import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import type { FileOperationTask } from '#entities/file'
import type { FileOperationGateway } from '../model/fileOperationGateway.ts'
import { FileMoveOperationModal } from './FileMoveOperationModal.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const task: FileOperationTask = {
  id: 'move', revision: 1, file_session_id: 'session', type: 'move', status: 'completed', phase: 'done', path: '/a',
  total_bytes: 1, transferred_bytes: 1, remaining_bytes: 0, phase_total_bytes: 1, phase_transferred_bytes: 1,
  phase_progress_percent: 100, progress_percent: 100, speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0,
  elapsed_seconds: 1, cancellable: false, created_at: '2026-09-20T00:00:00Z',
}

function gateway() {
  return {
    fileOperation: vi.fn().mockResolvedValue(task),
    fileOperationResult: vi.fn(),
    fileOperationEventsUrl: () => 'ws://127.0.0.1/move',
    cancelFileOperation: vi.fn(),
  } as unknown as FileOperationGateway
}

describe('移动任务反馈', () => {
  it('结果读取失败时不误报全部成功，保留关闭入口', async () => {
    const api = gateway()
    vi.mocked(api.fileOperationResult).mockRejectedValue(new Error('result unavailable'))
    const onClose = vi.fn()
    const onFinished = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={task} onClose={onClose} onFinished={onFinished} /></ConfigProvider>)
    await waitFor(() => expect(screen.getByText('result unavailable')).toBeVisible())
    expect(screen.queryByText('files.move.done')).not.toBeInTheDocument()
    expect(onFinished).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'files.move.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('展示部分完成明细中的失败原因', async () => {
    const api = gateway()
    vi.mocked(api.fileOperationResult).mockResolvedValue({ non_atomic: true, partial: true, uncertain: false, items: [
      { source_path: '/a', target_path: '/b', status: 'failed', copied: true, message: '来源已变化，保留副本' },
    ] })
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={{ ...task, status: 'failed', partial: true }} onClose={vi.fn()} onFinished={vi.fn()} /></ConfigProvider>)
    await waitFor(() => expect(screen.getByText('来源已变化，保留副本')).toBeVisible())
    expect(screen.getByText('files.move.incomplete')).toBeVisible()
  })

  it('取消请求尚未返回时阻止重复提交', async () => {
    const api = gateway()
    vi.mocked(api.cancelFileOperation).mockReturnValue(new Promise(() => {}))
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={{ ...task, status: 'running', cancellable: true }} onClose={vi.fn()} onFinished={vi.fn()} /></ConfigProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /files.move.cancelling/ })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /files.move.cancelling/ }))
    expect(api.cancelFileOperation).toHaveBeenCalledOnce()
  })
})
