import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemClipboardState } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { renderWithFeedback } from '../../../test/renderWithFeedback'
import { FileSystemClipboardNotification } from './FileSystemClipboardNotification'

const fixture = vi.hoisted(() => ({
  state: {} as FileSystemClipboardState,
  cancelling: false,
  revoke: vi.fn(),
}))
vi.mock('../model/useFileSystemClipboard', () => ({ useFileSystemClipboard: () => fixture }))

const ready: FileSystemClipboardState = {
  supported: true, phase: 'ready', published: true, operation_id: 'operation-1',
  publication_id: 'first', names: ['报告.pdf', '资料'], count: 2, total_bytes: 123,
}
beforeAll(async () => { await changeLanguage('zh-CN') })
beforeEach(() => { fixture.state = { ...ready }; fixture.cancelling = false; fixture.revoke.mockReset() })

describe('系统复制右上角消息', () => {
  it('单文件只显示一次名称，进度数值独立排版，连接关闭立即撤下通知', async () => {
    fixture.state = { ...ready, count: 1, names: ['多块.bin'], task: { id: 'task', status: 'running', current_file: '多块.bin', transferred_bytes: 24 * 1024 * 1024, total_bytes: 25 * 1024 * 1024, progress_percent: 96, cancellable: true } }
    const view = renderWithFeedback(<FileSystemClipboardNotification />)
    const notice = await screen.findByRole('status')
    expect(within(notice).getAllByText('多块.bin')).toHaveLength(1)
    expect(within(notice).getAllByText('96%')).toHaveLength(1)
    expect(notice).toHaveTextContent('24 MB / 25 MB')
    fixture.state = { ...fixture.state, phase: 'closed', published: false }
    view.rerender(<FileSystemClipboardNotification />)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(screen.queryByRole('button', { name: '取消复制' })).toBeNull()
  })
  it('消息脱离文件列表，原位更新进度，有效期间只能取消复制', async () => {
    const view = renderWithFeedback(<><section aria-label="文件列表" /><FileSystemClipboardNotification /></>)
    const notice = await screen.findByRole('status')
    expect(notice.closest('.ant-notification-topRight')).toBeInTheDocument()
    expect(view.container).not.toContainElement(notice)
    expect(notice).toHaveTextContent('已复制 2 项')
    expect(notice).toHaveTextContent('报告.pdf、资料')
    expect(within(notice).queryByRole('button', { name: '关闭' })).toBeNull()
    fixture.state = { ...ready, task: { id: 'task', status: 'running', transferred_bytes: 30, total_bytes: 123, progress_percent: 24, cancellable: true } }
    view.rerender(<><section aria-label="文件列表" /><FileSystemClipboardNotification /></>)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在复制到本机'))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消复制' }))
    expect(fixture.revoke).toHaveBeenCalledWith('first')
  })

  it('确认取消后常显 2 秒，轮询重绘不延后消失，后续新复制可以提示', async () => {
    const view = renderWithFeedback(<FileSystemClipboardNotification />)
    await screen.findByRole('status')
    fixture.cancelling = true
    view.rerender(<FileSystemClipboardNotification />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在取消复制'))
    expect(screen.getByRole('button', { name: /取消复制/ })).toBeDisabled()
    fixture.cancelling = false
    fixture.state = { ...ready, phase: 'stopped' }
    view.rerender(<FileSystemClipboardNotification />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消复制'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)) })
    fixture.state = { ...fixture.state }
    view.rerender(<FileSystemClipboardNotification />)
    expect(screen.getByRole('status')).toHaveTextContent('已取消复制')
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 1600 })
    view.rerender(<FileSystemClipboardNotification />)
    expect(screen.queryByRole('status')).toBeNull()
    fixture.state = { ...ready, operation_id: 'operation-2', publication_id: 'second' }
    view.rerender(<FileSystemClipboardNotification />)
    expect(await screen.findByRole('status')).toHaveTextContent('已复制 2 项')
  })

  it('取消失败保留重试入口，不提前显示已取消或自动关闭', async () => {
    fixture.state = { ...ready, phase: 'cleanup_pending', error_code: 'FILE_CLIPBOARD_CANCEL_FAILED' }
    renderWithFeedback(<FileSystemClipboardNotification />)
    expect(await screen.findByRole('alert')).toHaveTextContent('取消未完成')
    fireEvent.click(screen.getByRole('button', { name: '重试取消' }))
    expect(fixture.revoke).toHaveBeenCalledWith('first')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)) })
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法取消，请重试。')
  })

  it('旧取消计时器不能关闭新的复制消息', async () => {
    fixture.state = { ...ready, phase: 'stopped' }
    const view = renderWithFeedback(<FileSystemClipboardNotification />)
    await screen.findByRole('status')
    fixture.state = { ...ready, operation_id: 'new', publication_id: 'new' }
    view.rerender(<FileSystemClipboardNotification />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)) })
    expect(screen.getByRole('status')).toHaveTextContent('已复制 2 项')
  })
})
