import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import type { AgentWorkspaceToolPart } from '../model/types.ts'
import { AgentToolTimeline } from './AgentToolTimeline.tsx'

it('读取卡片按需挂载，原始详情独立展开，收起时释放正文视图', async () => {
  await i18n.changeLanguage('zh-CN')
  const tool: AgentWorkspaceToolPart = { id: 'file', kind: 'tool', name: 'termous.local.files.read', status: 'completed',
    detail: 'raw-receipt', local_file: { action: 'read', path: 'C:/test.txt', size: 11, offset: 0, nextOffset: 11, text: 'hello\nworld' } }
  render(<I18nextProvider i18n={i18n}><AgentToolTimeline tool={tool} /></I18nextProvider>)
  expect(screen.queryByRole('region', { name: '文件内容审阅' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('读取文件 · test.txt'))
  expect(await screen.findByRole('region', { name: '文件内容审阅' })).toBeVisible()
  expect(screen.getByText('hello')).toBeVisible()
  expect(screen.queryByText('raw-receipt')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '原始详情' }))
  expect(screen.getByText('raw-receipt')).toBeVisible()
  fireEvent.click(screen.getByText('读取文件 · test.txt'))
  await waitFor(() => expect(screen.queryByRole('region', { name: '文件内容审阅' })).not.toBeInTheDocument())
})

it('内部申请控制时说明尚未发送输入，授权后再展示实际点击', async () => {
  await i18n.changeLanguage('zh-CN')
  const tool: AgentWorkspaceToolPart = { id: 'click', kind: 'tool', name: 'termous.desktops.pointer.click', status: 'running', phase: 'waiting' }
  const element = (value: AgentWorkspaceToolPart) => <I18nextProvider i18n={i18n}><AgentToolTimeline tool={value} /></I18nextProvider>
  const { rerender } = render(element(tool))
  expect(screen.getByText('申请桌面控制权限')).toHaveAttribute('title', tool.name)
  expect(screen.getByText('等待授权，尚未发送输入')).toBeVisible()
  rerender(element({ ...tool, status: 'waiting_approval' }))
  expect(screen.getByText('申请桌面控制权限')).toBeVisible()
  rerender(element({ ...tool, phase: 'executing' }))
  expect(screen.getByText(tool.name)).toBeVisible()
  expect(screen.queryByText('等待授权，尚未发送输入')).toBeNull()
  rerender(element({ ...tool, status: 'failed' }))
  expect(screen.getByText(tool.name)).toBeVisible()
  expect(screen.queryByText('申请桌面控制权限')).toBeNull()
})

it('后台等待直接请求取消，失败时明确保留未确认状态并可重新核查', async () => {
  await i18n.changeLanguage('zh-CN')
  const cancel = vi.fn().mockRejectedValue(new Error('连接中断'))
  const tool: AgentWorkspaceToolPart = { id: 'batch', kind: 'tool', name: 'termous.desktops.execute', status: 'running', cancelDesktop: cancel,
    desktop_batch: { id: 'desktop_execution_batch', state: 'running', phase: 'waiting', accepted_actions: 1, capture_state: 'pending',
      steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 30000 }] } }
  const { rerender } = render(<I18nextProvider i18n={i18n}><AgentToolTimeline tool={tool} /></I18nextProvider>)
  fireEvent.click(screen.getByText(tool.name))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('取消请求未确认'))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
  rerender(<I18nextProvider i18n={i18n}><AgentToolTimeline tool={{ ...tool, status: 'failed', cancelDesktop: undefined,
    desktop_batch: { ...tool.desktop_batch!, state: 'cancelled' } }} /></I18nextProvider>)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
})

it('取消请求返回后仍显示真实执行状态，允许重试且不永久锁定按钮', async () => {
  await i18n.changeLanguage('zh-CN')
  const cancel = vi.fn().mockResolvedValue(undefined)
  const tool: AgentWorkspaceToolPart = { id: 'pending', kind: 'tool', name: 'termous.desktops.execute', status: 'running', cancelDesktop: cancel }
  render(<I18nextProvider i18n={i18n}><AgentToolTimeline tool={tool} /></I18nextProvider>)
  fireEvent.click(screen.getByText(tool.name))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toBeEnabled())
  expect(screen.getByText('执行中')).toBeVisible()
  expect(cancel).toHaveBeenCalledTimes(1)
})
