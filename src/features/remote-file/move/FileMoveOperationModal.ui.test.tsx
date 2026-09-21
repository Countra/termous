import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('任务查询异常时提示结果未知并允许关闭，恢复后继续跟踪', async () => {
    vi.useFakeTimers()
    const api = gateway()
    const running = { ...task, status: 'running' as const, cancellable: true }
    const onClose = vi.fn()
    const onFinished = vi.fn()
    vi.mocked(api.fileOperation).mockRejectedValue(new Error('本地 API 暂时不可用'))
    const view = render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={running} onClose={onClose} onFinished={onFinished} /></ConfigProvider>)
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(screen.getByText('files.move.observationFailed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'files.move.close' })).toBeEnabled()
      expect(onFinished).not.toHaveBeenCalled()
      expect(api.fileOperationResult).not.toHaveBeenCalled()

      vi.mocked(api.fileOperation).mockResolvedValue(running)
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(screen.queryByText('files.move.observationFailed')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'files.move.close' })).toBeDisabled()

      vi.mocked(api.fileOperation).mockRejectedValue(null)
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(screen.getByText('files.move.observationFailed')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'files.move.close' }))
      expect(onClose).toHaveBeenCalledOnce()
      expect(api.cancelFileOperation).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('单项重命名展示原名称、新名称及一次失败原因，不显示移动表格和终态进度条', async () => {
    const api = gateway()
    const message = '无法重命名：目标路径“/occupied”已存在同名文件夹，请使用其他名称'
    vi.mocked(api.fileOperationResult).mockResolvedValue({ non_atomic: false, partial: false, uncertain: false, items: [
      { source_path: '/a', target_path: '/occupied', status: 'failed', message },
    ] })
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} rename={{ sourcePath: '/a', targetPath: '/occupied' }} initialTask={{ ...task, status: 'failed', error_code: 'SFTP_RENAME_CONFLICT', error_message: message }} onClose={vi.fn()} onFinished={vi.fn()} /></ConfigProvider>)
    await waitFor(() => expect(api.fileOperationResult).toHaveBeenCalled())
    expect(screen.getAllByText(message)).toHaveLength(1)
    expect(screen.getByText('files.move.renameTitle')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'files.move.feedback.failed' })).toBeVisible()
    expect(screen.getByText('a')).toBeVisible()
    expect(screen.getByText('occupied')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('files.move.feedback.done')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.move.close' })).toBeEnabled()
  })

  it('结果读取失败时不误报全部成功，保留关闭入口', async () => {
    const api = gateway()
    vi.mocked(api.fileOperationResult).mockRejectedValue(new Error('result unavailable'))
    const onClose = vi.fn()
    const onFinished = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={task} onClose={onClose} onFinished={onFinished} /></ConfigProvider>)
    await waitFor(() => expect(screen.getByText('result unavailable')).toBeVisible())
    expect(screen.queryByText('files.move.feedback.done')).not.toBeInTheDocument()
    expect(screen.getByText('files.move.feedback.unavailable')).toBeVisible()
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
    expect(screen.getByText('files.move.feedback.partial')).toBeVisible()
    expect(screen.getByText('files.move.partialHint')).toBeVisible()
    expect(screen.getByRole('table')).toBeVisible()
  })

  it('预检查失败尚无明细时仍保留本次重命名的名称和目录', async () => {
    const api = gateway()
    vi.mocked(api.fileOperationResult).mockResolvedValue({ non_atomic: true, partial: false, uncertain: false, items: [] })
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} rename={{ sourcePath: '/srv/old.txt', targetPath: '/srv/new.txt' }} initialTask={{ ...task, status: 'failed', error_message: '目标已存在' }} onClose={vi.fn()} onFinished={vi.fn()} /></ConfigProvider>)
    await waitFor(() => expect(api.fileOperationResult).toHaveBeenCalled())
    expect(screen.getByText('old.txt')).toBeVisible()
    expect(screen.getByText('new.txt')).toBeVisible()
    expect(screen.getByText('/srv')).toBeVisible()
    expect(screen.getByText('目标已存在')).toBeVisible()
    expect(screen.queryByText('files.move.nonAtomic')).not.toBeInTheDocument()
  })

  it.each([
    { status: 'cancelled' as const, uncertain: false, partial: false, heading: 'cancelled', hint: 'cancelledHint' },
    { status: 'failed' as const, uncertain: true, partial: true, heading: 'uncertain', hint: 'uncertainHint' },
  ])('区分 $heading 与普通失败，保持结果核对提示', async ({ status, uncertain, partial, heading, hint }) => {
    const api = gateway()
    vi.mocked(api.fileOperationResult).mockResolvedValue({ non_atomic: true, partial, uncertain, items: [] })
    render(<ConfigProvider theme={{ token: { motion: false } }}><FileMoveOperationModal api={api} initialTask={{ ...task, status, partial }} onClose={vi.fn()} onFinished={vi.fn()} /></ConfigProvider>)
    await waitFor(() => expect(screen.getByText(`files.move.feedback.${heading}`)).toBeVisible())
    expect(screen.getByText(`files.move.${hint}`)).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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
