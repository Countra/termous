import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TransferTask } from '#entities/file'
import type { FileTransferGateway } from '#features/files'
import {
  TransferRuntimeContext,
  type TransferRuntimeValue,
} from '#features/transfers'
import { WorkbenchTransferBar } from './WorkbenchTransferBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function transferTask(type: TransferTask['type']): TransferTask {
  return {
    id: 'transfer-1',
    host_id: 'host-source',
    file_session_id: 'session-source',
    source_file_session_id: type === 'remote_copy' ? 'session-source' : undefined,
    target_file_session_id: type === 'remote_copy' ? 'session-target' : undefined,
    type,
    status: 'running',
    source_paths: ['/source'],
    target_path: '/target',
    total_bytes: 100,
    transferred_bytes: 50,
    remaining_bytes: 50,
    total_files: 1,
    completed_files: 0,
    progress_percent: 50,
    speed_bytes_per_sec: 10,
    average_speed_bytes_per_sec: 10,
    elapsed_seconds: 1,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-08-15T00:00:00Z',
  }
}

function renderTransferBar(
  type: TransferTask['type'],
  overrides: Partial<TransferTask> = {},
  additionalTasks: TransferTask[] = [],
) {
  const task = { ...transferTask(type), ...overrides }
  const refresh = vi.fn(async () => undefined)
  const removeTransfer = vi.fn()
  const deleteTransfer = vi.fn(async () => undefined)
  const runtime: TransferRuntimeValue = {
    transfers: [task, ...additionalTasks],
    activeTransfers: [task, ...additionalTasks].filter((item) => (
      item.status === 'queued' || item.status === 'running'
    )),
    connected: true,
    initialized: true,
    remoteCopyRefreshVersion: 0,
    refresh,
    upsertTransfer: vi.fn(),
    removeTransfer,
    consumeRemoteCopyRefreshEvents: vi.fn(() => []),
  }
  const api = {
    deleteTransfer,
    retryTransfer: vi.fn(),
  } as unknown as FileTransferGateway

  render(
    <TransferRuntimeContext.Provider value={runtime}>
      <WorkbenchTransferBar
        api={api}
        fileSessionId="session-source"
        onActionError={vi.fn()}
      />
    </TransferRuntimeContext.Provider>,
  )

  return { deleteTransfer, refresh, removeTransfer }
}

describe('工作台传输条取消行为', () => {
  it('跨主机复制取消后保留任务并刷新最终状态', async () => {
    const user = userEvent.setup()
    const actions = renderTransferBar('remote_copy')

    await user.click(screen.getByRole('button', { name: 'files.cancelTransfer' }))

    await waitFor(() => expect(actions.deleteTransfer).toHaveBeenCalledWith('transfer-1'))
    expect(actions.refresh).toHaveBeenCalledTimes(1)
    expect(actions.removeTransfer).not.toHaveBeenCalled()
  })

  it('普通上传取消仍沿用即时移除行为', async () => {
    const user = userEvent.setup()
    const actions = renderTransferBar('upload_file')

    await user.click(screen.getByRole('button', { name: 'files.cancelTransfer' }))

    await waitFor(() => expect(actions.deleteTransfer).toHaveBeenCalledWith('transfer-1'))
    expect(actions.refresh).not.toHaveBeenCalled()
    expect(actions.removeTransfer).toHaveBeenCalledWith('transfer-1')
  })

  it('MCP 托管任务显示来源标识并保留取消入口', () => {
    renderTransferBar('download_file', { origin: 'mcp' })

    expect(screen.getByRole('img', { name: 'files.transferOrigin.mcp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.cancelTransfer' })).toBeEnabled()
    expect(document.querySelector('[data-workbench-file-transfer]')).toHaveAttribute(
      'data-transfer-origin',
      'mcp',
    )
  })

  it('聚合多个活动任务时只要包含 MCP 任务就显示来源标识', () => {
    renderTransferBar('upload_file', {}, [{
      ...transferTask('download_file'),
      id: 'transfer-mcp',
      origin: 'mcp',
    }])

    expect(screen.getByRole('img', { name: 'files.transferOrigin.mcp' })).toBeInTheDocument()
    expect(document.querySelector('[data-workbench-file-transfer]')).toHaveAttribute(
      'data-transfer-origin',
      'mcp',
    )
  })
})
