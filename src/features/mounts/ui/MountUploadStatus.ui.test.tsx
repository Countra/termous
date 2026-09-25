import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MountUploadStatus } from './MountUploadStatus'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const summary = { active_files: 0, finalizing_files: 0, buffered_files: 0, failed_files: 0, accepted_bytes: 1024, transferred_bytes: 1024, pending_bytes: 0 }

describe('挂载上传摘要', () => {
  it('正文传完仍显示正在完成，不显示百分比完成', () => {
    render(<MountUploadStatus uploads={{ ...summary, finalizing_files: 1, progress_kind: 'confirmed' }} />)
    expect(screen.getByText('mounts.upload.finalizing')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.basis.confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
  it('兼容写回说明原因，传输进展不冒充服务端确认', () => {
    render(<MountUploadStatus uploads={{ ...summary, active_files: 1, buffered_files: 1, progress_kind: 'transport', reason: 'non_sequential' }} />)
    expect(screen.getByText('mounts.upload.basis.transport')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.reasons.non_sequential')).toBeInTheDocument()
  })
  it('旧 Core 或空状态不增加界面占位', () => {
    const { container, rerender } = render(<MountUploadStatus />)
    expect(container).toBeEmptyDOMElement()
    rerender(<MountUploadStatus uploads={summary} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('失败保留数据，不显示仍在上传', () => {
    render(<MountUploadStatus uploads={{ ...summary, failed_files: 1 }} />)
    expect(screen.getByText('mounts.upload.failed')).toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.active')).not.toBeInTheDocument()
  })
  it.each([
    ['stopping_files', 'mounts.upload.stopping'],
    ['cleaning_files', 'mounts.upload.cleaning'],
    ['cleanup_failed_files', 'mounts.upload.cleanupFailed'],
  ] as const)('单独的 %s 保留可见且不提示继续上传', (field, label) => {
    render(<MountUploadStatus uploads={{ ...summary, [field]: 1, progress_kind: 'confirmed' }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.active')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.finalizing')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.bytes')).not.toBeInTheDocument()
    expect(screen.queryByText('mounts.upload.basis.confirmed')).not.toBeInTheDocument()
  })
  it('清理失败展示具体原因，同时保留其他文件的上传状态', () => {
    render(<MountUploadStatus uploads={{ ...summary, cleanup_failed_files: 1, active_files: 1, progress_kind: 'confirmed', error: '远端清理超时' }} />)
    expect(screen.getByText('mounts.upload.cleanupFailed')).toBeInTheDocument()
    expect(screen.getByText('远端清理超时')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.active')).toBeInTheDocument()
    expect(screen.getByText('mounts.upload.bytes')).toBeInTheDocument()
  })
})
