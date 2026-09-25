import { fireEvent, render, screen, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { MountInstance } from '#entities/mount'
import { MountRuntime } from './MountRuntime'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))

const instance: MountInstance = {
  id: 'run', name: 'SMB', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'I:', volume_name: '',
  read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0,
  start_origin: 'manual', state: 'running', phase: 'ready', mounted: true, retained: false, open_handles: 1, dirty_nodes: 1, started_at: '',
  uploads: { active_files: 0, finalizing_files: 0, buffered_files: 0, failed_files: 0, cleanup_failed_files: 1, accepted_bytes: 1024, transferred_bytes: 1024, pending_bytes: 0, error: '远端清理失败' },
}

function renderRuntime(value: MountInstance) {
  return render(<ConfigProvider theme={{ token: { motion: false } }}>
    <MountRuntime instance={value} sourceName="SMB" disabled={false} onAction={vi.fn()} onDiscard={vi.fn()} />
  </ConfigProvider>)
}

describe('运行项统一错误展示', () => {
  it.each([false, true])('只有上传错误或与实例错误重复时，只在弹层展示一次，实例错误=%s', async (withFailure) => {
    renderRuntime({ ...instance, failure: withFailure ? { operation: 'upload', message: '远端清理失败', at: '2026-09-25T12:00:00Z' } : undefined })
    const row = screen.getByRole('article')
    expect(within(row).queryByText('远端清理失败')).not.toBeInTheDocument()
    expect(within(row).queryByText('mounts.upload.cleanupFailed')).not.toBeInTheDocument()
    expect(within(row).getByText('mounts.upload.transferred').nextElementSibling).toHaveTextContent('1.0 KB')
    fireEvent.click(within(row).getByRole('button', { name: 'mounts.failure' }))
    expect(await screen.findByText('远端清理失败')).toBeInTheDocument()
    expect(screen.getAllByText('远端清理失败')).toHaveLength(1)
    expect(screen.getByText('mounts.upload.cleanupFailed')).toBeInTheDocument()
    if (!withFailure) expect(screen.queryByText('mounts.failureAt')).not.toBeInTheDocument()
  })

  it('不同来源的错误均可查看，同时保留正在传输状态', async () => {
    renderRuntime({ ...instance, failure: { operation: 'sync', message: '同步失败', at: '' }, uploads: { ...instance.uploads!, active_files: 1 } })
    expect(screen.getByText('mounts.upload.active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'mounts.failure' }))
    expect(await screen.findByText('同步失败')).toBeInTheDocument()
    expect(screen.getByText('远端清理失败')).toBeInTheDocument()
  })

  it('仅错误计数也有可查看的说明，恢复后移除入口', async () => {
    const { rerender } = renderRuntime({ ...instance, uploads: { ...instance.uploads!, error: undefined } })
    fireEvent.click(screen.getByRole('button', { name: 'mounts.failure' }))
    expect(await screen.findByText('mounts.upload.cleanupFailed')).toBeInTheDocument()
    rerender(<MountRuntime instance={{ ...instance, uploads: undefined }} sourceName="SMB" disabled={false} onAction={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'mounts.failure' })).not.toBeInTheDocument()
  })
})
