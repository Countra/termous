import { act, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DesktopFileClipboard as ClipboardState, RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import type { useDesktopFiles } from '../model/useDesktopFiles.ts'
import { DesktopFileClipboard } from './DesktopFileClipboard.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const session = { id: 'rdp-files', connection_generation: 3 } as RemoteDesktopSession
const viewer = { connection: 'connected', viewOnly: false, controlOwned: true, controlLease: { id: 'viewer', generation: 4 } } as RemoteDesktopViewerState
const state: ClipboardState = { available: true, published: true, serving: false, provided_bytes: 0, huge_files: true, locking: true, offered: false, content_generation: 8, files: [], total_files: 0 }

function props(clipboard: DesktopFilesGateway['clipboard']) {
  return {
    api: { clipboard } as DesktopFilesGateway, session, viewer,
    operations: { busy: false, run: vi.fn(), withGrant: vi.fn() } as unknown as ReturnType<typeof useDesktopFiles>,
    overwrite: 'rename' as const,
  }
}

test('文件清单发布后显示等待粘贴，关闭面板取消状态查询', async () => {
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue(state)
  const view = render(<DesktopFileClipboard {...props(clipboard)} />)
  expect(await screen.findByText('remoteDesktop.files.clipboardWaiting')).toBeVisible()
  expect(screen.queryByText('remoteDesktop.files.clipboardServing')).not.toBeInTheDocument()
  expect(clipboard).toHaveBeenCalledWith(session.id, { generation: 3, subscription_id: 'viewer', control_generation: 4, content_generation: 0 }, expect.any(AbortSignal))
  view.unmount()
  expect(clipboard.mock.calls[0]![2]!.aborted).toBe(true)
})

test('实际提供正文时展示供给状态，不根据准备任务完成推断目标落盘', async () => {
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockResolvedValue({ ...state, serving: true, provided_bytes: 4096 })
  render(<DesktopFileClipboard {...props(clipboard)} />)
  expect(await screen.findByText('remoteDesktop.files.clipboardServing')).toBeVisible()
  expect(screen.getByText('remoteDesktop.files.clipboardProvided')).toBeVisible()
  expect(screen.queryByText('remoteDesktop.files.clipboardWaiting')).not.toBeInTheDocument()
})

test('控制权丢失立即禁用所有操作，迟到的发布响应不恢复入口', async () => {
  let resolve!: (value: ClipboardState) => void
  const clipboard = vi.fn<DesktopFilesGateway['clipboard']>().mockReturnValue(new Promise(done => { resolve = done }))
  const input = props(clipboard)
  const view = render(<DesktopFileClipboard {...input} />)
  view.rerender(<DesktopFileClipboard {...input} viewer={{ ...viewer, controlOwned: false }} />)
  await act(async () => { resolve(state) })
  for (const action of ['publish', 'publishFolder', 'readClipboard', 'revoke']) {
    expect(screen.getByRole('button', { name: `remoteDesktop.files.${action}` })).toBeDisabled()
  }
  expect(clipboard.mock.calls[0]![2]!.aborted).toBe(true)
  expect(screen.queryByText('remoteDesktop.files.clipboardWaiting')).not.toBeInTheDocument()
})
