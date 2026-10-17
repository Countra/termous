import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { TransferTask } from '#entities/file'
import { DesktopClipboardProgress } from './DesktopClipboardProgress'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const task = { id: 'read', status: 'running', total_bytes: 24 * 1024 * 1024, transferred_bytes: 12 * 1024 * 1024, current_file: '中文大文件.bin', speed_bytes_per_sec: 1024 * 1024, cancellable: true } as TransferTask

test('系统接收展示文件名和实际字节进度，并复用任务取消', () => {
  const cancel = vi.fn()
  render(<DesktopClipboardProgress task={task} busy={false} cancel={cancel} />)
  expect(screen.getByText('中文大文件.bin')).toBeVisible()
  expect(screen.getByText('50%')).toBeVisible()
  expect(screen.getByText(/12.*24.*1.*\/s/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.clipboardReceiveCancel' }))
  expect(cancel).toHaveBeenCalledOnce()
})

test('失败保留已有进度并提示部分文件，完成不宣称目标已保存', () => {
  const view = render(<DesktopClipboardProgress task={{ ...task, status: 'failed', cancellable: false }} busy={false} cancel={vi.fn()} />)
  expect(screen.getByText('remoteDesktop.files.clipboardReceivePartial')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  view.rerender(<DesktopClipboardProgress task={{ ...task, status: 'completed', transferred_bytes: task.total_bytes, cancellable: false }} busy={false} cancel={vi.fn()} />)
  expect(screen.getByText('remoteDesktop.files.clipboardReceiveResult')).toBeVisible()
  expect(screen.queryByText('remoteDesktop.files.clipboardReceivePartial')).not.toBeInTheDocument()
})
