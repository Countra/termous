import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { NotificationMessage } from '#entities/notification'
import { NotificationCenter, type NotificationCenterProps } from './NotificationCenter'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))
const item: NotificationMessage = { id: 'one', sequence: 1, kind: 'file', outcome: 'partial', source_id: 'transfer', operation: 'upload_file', name: 'example.zip', completed_files: 1, total_files: 2, skipped_items: 1, occurred_at: new Date().toISOString(), native_eligible: true, read: false }
function props(): NotificationCenterProps {
  return { state: { items: [item], watermark: 1, unread: 1, connected: true, loaded: true, error: false }, open: true, filter: 'all', selected: null, unavailable: false, busy: false, error: false, onOpen: vi.fn(), onFilter: vi.fn(), onView: vi.fn(), onReadAll: vi.fn(), onClearRead: vi.fn(), onDismiss: vi.fn() }
}
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
