import { ConfigProvider } from 'antd'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { NotificationMessage } from '#entities/notification'
import { NotificationCenter, type NotificationCenterProps } from './NotificationCenter'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))
const item: NotificationMessage = { id: 'one', sequence: 1, kind: 'file', outcome: 'partial', source_id: 'transfer', operation: 'upload_file', name: 'example.zip', completed_files: 1, total_files: 2, skipped_items: 1, occurred_at: new Date().toISOString(), native_eligible: true, read: false }
function props(): NotificationCenterProps {
  return { state: { items: [item], watermark: 1, unread: 1, connected: true, loaded: true, error: false }, open: true, filter: 'all', selected: null, unavailable: false, busy: false, error: false, onOpen: vi.fn(), onFilter: vi.fn(), onView: vi.fn(), onReadAll: vi.fn(), onClearRead: vi.fn(), onDismiss: vi.fn() }
}
test.each([1, 12, 128])('点击 %s 条未读角标打开消息中心一次，不自动标记已读', (unread) => {
  const input = props()
  input.state.unread = unread
  render(<NotificationCenter {...input} open={false} />)
  fireEvent.click(screen.getByTitle(String(unread)))
  expect(input.onOpen).toHaveBeenCalledExactlyOnceWith(true)
  expect(input.onReadAll).not.toHaveBeenCalled()
  expect(input.onView).not.toHaveBeenCalled()
})

test('打开抽屉不自动已读；保留部分完成摘要并支持独立移除', () => {
  const input = props()
  render(<NotificationCenter {...input} />)
  expect(input.onReadAll).not.toHaveBeenCalled()
  expect(screen.getByText('文件上传部分完成')).toBeInTheDocument()
  expect(screen.getByText('example.zip')).toBeInTheDocument()
  expect(screen.getByText('完成 1 / 2 项 · 跳过 1 项')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /notifications.dismiss ·/ }))
  expect(input.onDismiss).toHaveBeenCalledWith(item)
  expect(input.onView).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /文件上传部分完成.*example.zip/ }))
  expect(input.onView).toHaveBeenCalledWith(item)
})

test('会话标题和内容概览分别展示，审批消息进入对应操作', () => {
  const input = props()
  const agent: NotificationMessage = { ...item, id: 'agent', kind: 'agent', operation: 'run', outcome: 'success', session_title: '排查数据库连接', preview: '已检查连接并修复超时配置。' }
  const approval: NotificationMessage = { ...item, id: 'approval', kind: 'approval', operation: 'command', outcome: 'attention', source_name: 'AI 助手', target_count: 1 }
  input.state.items = [agent, approval]
  render(<NotificationCenter {...input} />)
  expect(screen.getByText('排查数据库连接')).toBeInTheDocument()
  expect(screen.getByText('已检查连接并修复超时配置。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /有命令待审批.*AI 助手/ }))
  expect(input.onView).toHaveBeenCalledWith(approval)
})
test('失效目标显示保留结果，清理已读在没有已读项时禁用', () => {
  render(<NotificationCenter {...props()} selected={item} unavailable />)
  expect(screen.getByText('notifications.targetMissing')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'notifications.clearRead' })).toBeDisabled()
})

function CenterLifecycle({ input }: { input: NotificationCenterProps }) {
  const [open, setOpen] = useState(false)
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <NotificationCenter {...input} open={open} onOpen={setOpen} onView={(message) => { input.onView(message); setOpen(false) }} />
  </ConfigProvider>
}

test.each(['close', 'mask', 'escape', 'message'] as const)('%s 关闭消息抽屉后移除整屏覆盖层，重新打开保留筛选和交互', async (action) => {
  const input = props()
  render(<CenterLifecycle input={input} />)
  const trigger = screen.getByRole('button', { name: 'notifications.title' })
  expect(document.querySelector('.ant-drawer')).toBeNull()
  trigger.focus()
  fireEvent.click(trigger)
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('tab', { name: 'notifications.unread' }))
  if (action === 'close') fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  else if (action === 'mask') fireEvent.click(document.querySelector('.ant-drawer-mask')!)
  else if (action === 'escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape', keyCode: 27 })
  else fireEvent.click(screen.getByRole('button', { name: /文件上传部分完成.*example.zip/ }))
  await waitFor(() => expect(document.querySelector('.ant-drawer')).toBeNull())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger).toHaveFocus()
  expect(input.onView).toHaveBeenCalledTimes(action === 'message' ? 1 : 0)
  fireEvent.click(trigger)
  await screen.findByRole('dialog')
  expect(screen.getByRole('tab', { name: 'notifications.unread' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('example.zip')).toBeInTheDocument()
})
