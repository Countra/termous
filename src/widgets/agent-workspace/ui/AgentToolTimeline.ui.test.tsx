import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import type { AgentWorkspaceToolPart } from '../model/types.ts'
import { AgentToolTimeline } from './AgentToolTimeline.tsx'

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
