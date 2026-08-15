import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransferTask } from '#entities/file'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'files.remoteCopy.route') {
        return `${options?.source} -> ${options?.target}`
      }
      if (key === 'files.remoteCopy.skippedItems') {
        return `skipped:${options?.count}`
      }
      return key
    },
  }),
}))

import { TransferQueuePanel } from './TransferQueuePanel'

function remoteCopyTask(): TransferTask {
  return {
    id: 'remote-copy-1',
    host_id: 'source-host',
    file_session_id: 'source-session',
    source_host_id: 'source-host',
    source_file_session_id: 'source-session',
    source_connection_generation: 3,
    target_host_id: 'target-host',
    target_file_session_id: 'target-session',
    target_connection_generation: 5,
    type: 'remote_copy',
    status: 'failed',
    phase: 'scanning',
    failure_side: 'target',
    partial: true,
    skipped_items: 3,
    source_paths: ['/source/example.txt'],
    target_path: '/target',
    total_bytes: 100,
    transferred_bytes: 40,
    remaining_bytes: 60,
    total_files: 1,
    completed_files: 0,
    progress_percent: 40,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 8,
    elapsed_seconds: 2,
    cancellable: false,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-08-15T00:00:00Z',
  }
}

describe('跨主机传输队列展示合同', () => {
  it('即使未开启普通主机上下文也展示双端路由和任务补充状态', () => {
    render(
      <AntdApp>
        <TransferQueuePanel
          transfers={[remoteCopyTask()]}
          hostNames={{
            'source-host': 'Source host',
            'target-host': 'Target host',
          }}
          showHostContext={false}
          onCancel={vi.fn()}
          onDelete={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn()}
        />
      </AntdApp>,
    )

    expect(screen.getByLabelText('Source host -> Target host')).toBeInTheDocument()
    expect(screen.getByText('files.remoteCopy.phaseScanning')).toBeInTheDocument()
    expect(screen.getByText('files.remoteCopy.partial')).toBeInTheDocument()
    expect(screen.getByText('skipped:3')).toBeInTheDocument()
    expect(screen.getByText('Target host')).toHaveClass('is-failure-side')
  })

  it('扫描阶段在总量未知时显示不确定进度', () => {
    render(
      <AntdApp>
        <TransferQueuePanel
          transfers={[{
            ...remoteCopyTask(),
            status: 'running',
            failure_side: undefined,
            partial: false,
            skipped_items: 0,
            total_bytes: 0,
            transferred_bytes: 0,
            remaining_bytes: 0,
            progress_percent: 0,
            cancellable: true,
          }]}
          hostNames={{
            'source-host': 'Source host',
            'target-host': 'Target host',
          }}
          showHostContext={false}
          onCancel={vi.fn()}
          onDelete={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn()}
        />
      </AntdApp>,
    )

    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveClass('is-indeterminate')
    expect(progress).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('成功任务不再显示已经结束的整理阶段', () => {
    render(
      <AntdApp>
        <TransferQueuePanel
          transfers={[{
            ...remoteCopyTask(),
            status: 'completed',
            phase: 'finalizing',
            failure_side: undefined,
            partial: false,
            skipped_items: 0,
            transferred_bytes: 100,
            remaining_bytes: 0,
            completed_files: 1,
            progress_percent: 100,
          }]}
          hostNames={{
            'source-host': 'Source host',
            'target-host': 'Target host',
          }}
          showHostContext={false}
          onCancel={vi.fn()}
          onDelete={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn()}
        />
      </AntdApp>,
    )

    expect(screen.getByText('files.transferStatus.completed')).toBeInTheDocument()
    expect(screen.queryByText('files.remoteCopy.phaseFinalizing')).not.toBeInTheDocument()
  })
})
