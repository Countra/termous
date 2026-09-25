import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MountUploadStatus } from './MountUploadStatus'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const summary = { active_files: 0, finalizing_files: 0, buffered_files: 0, failed_files: 0, accepted_bytes: 0, transferred_bytes: 0, pending_bytes: 0 }

describe('挂载上传摘要', () => {
  it('正文传完仍显示正在完成，按需查看进度说明', async () => {
    render(<MountUploadStatus uploads={{ ...summary, finalizing_files: 1, progress_kind: 'confirmed' }} />)
    expect(screen.getByText('mounts.upload.finalizing')).toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.basis.confirmed')).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('button', { name: 'mounts.upload.details' }))
    expect(await screen.findByText('mounts.upload.basis.confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
  it('兼容写回说明原因，传输进展不冒充服务端确认', async () => {
    render(<MountUploadStatus uploads={{ ...summary, active_files: 1, buffered_files: 1, progress_kind: 'transport', reason: 'non_sequential' }} />)
    fireEvent.focus(screen.getByRole('button', { name: 'mounts.upload.details' }))
    expect(await screen.findByText('mounts.upload.basis.transport')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.reasons.non_sequential')).toBeInTheDocument()
  })
  it('旧 Core 或空状态不增加界面占位', () => {
    const { container, rerender } = render(<MountUploadStatus />)
    expect(container).toBeEmptyDOMElement()
    rerender(<MountUploadStatus uploads={summary} />)
    expect(container).toBeEmptyDOMElement()
  })
  it.each(['failed_files', 'cleanup_failed_files'] as const)('仅有 %s 且无字节统计时不增加空白区域', (field) => {
    const { container } = render(<MountUploadStatus uploads={{ ...summary, [field]: 1, error: '收尾失败' }} />)
    expect(container).toBeEmptyDOMElement()
  })
  it.each(['active_files', 'finalizing_files', 'buffered_files', 'failed_files', 'cleanup_failed_files'] as const)('%s 保留实际传输量及待传输量，不展示错误正文', (field) => {
    render(<MountUploadStatus uploads={{ ...summary, [field]: 1, accepted_bytes: 120 << 20, transferred_bytes: 112 << 20, pending_bytes: 8 << 20, error: '收尾失败' }} />)
    expect(screen.getByText('mounts.upload.transferred').nextElementSibling).toHaveTextContent('112 MB')
    expect(screen.getByText('mounts.upload.pending').nextElementSibling).toHaveTextContent('8.0 MB')
    expect(screen.queryByText('收尾失败')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.failed')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.cleanupFailed')).not.toBeInTheDocument()
  })
  it.each([
    ['stopping_files', 'mounts.upload.stopping'],
    ['cleaning_files', 'mounts.upload.cleaning'],
  ] as const)('单独的 %s 保留已传输量且不提示继续上传', async (field, label) => {
    render(<MountUploadStatus uploads={{ ...summary, [field]: 1, accepted_bytes: 120 << 20, transferred_bytes: 112 << 20, progress_kind: 'confirmed' }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.active')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.finalizing')).not.toBeInTheDocument()
    expect(screen.getByText('mounts.upload.transferred').nextElementSibling).toHaveTextContent('112 MB')
    expect(screen.getByText('mounts.upload.pending').nextElementSibling).toHaveTextContent('0 B')
    fireEvent.focus(screen.getByRole('button', { name: 'mounts.upload.details' }))
    expect(await screen.findByText('mounts.upload.basis.confirmed')).toBeInTheDocument()
  })
  it('仅有字节统计也保留显示，摘要清空后移除', () => {
    const { container, rerender } = render(<MountUploadStatus uploads={{ ...summary, transferred_bytes: 112 << 20 }} />)
    expect(screen.getByText('112 MB')).toBeInTheDocument()
    rerender(<MountUploadStatus uploads={summary} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('错误留给错误组件，运行项仅保留其他文件的传输状态', () => {
    render(<MountUploadStatus uploads={{ ...summary, cleanup_failed_files: 1, active_files: 1, progress_kind: 'confirmed', error: '远端清理超时' }} />)
    expect(screen.queryByText('mounts.upload.cleanupFailed')).not.toBeInTheDocument()
    expect(screen.queryByText('远端清理超时')).not.toBeInTheDocument()
    expect(screen.getByText('mounts.upload.active')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.transferred')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.pending')).toBeInTheDocument()
  })
})
