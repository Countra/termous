import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import type { AgentProgressActivity } from '#entities/agent'
import { AgentConversation } from './AgentConversation.tsx'

it('纠错提示可展开，继续执行后的同一诊断原位更新为恢复状态', async () => {
  const localized = i18n.cloneInstance({ lng: 'zh-CN' })
  await localized.changeLanguage('zh-CN')
  const activity: AgentProgressActivity = { pattern_id: 'pattern', assistant_message_id: 'assistant', after_part_sequence: 0,
    tool_name: 'termous.desktops.capture', reason: 'repeated_observation', status: 'detected', count: 3,
    guidance: '截图只返回 screenshot_id；固定帧需要 snapshot_id。', next_tools: ['termous.desktop_workflows.captures.create'], created_at: '2026-10-15T00:00:00Z' }
  const element = (value: AgentProgressActivity) => <I18nextProvider i18n={localized}><AgentConversation
    messages={[{ id: 'assistant', role: 'assistant', status: 'streaming', created_at: value.created_at, attachments: [],
      parts: [{ id: 'progress:pattern', kind: 'progress', activity: value }] }]} runStatus="running" loading={false} sessionKey="fixture" />
  </I18nextProvider>
  const { container, rerender } = render(element(activity))
  const detail = container.querySelector('details')!
  expect(detail).not.toHaveAttribute('open')
  await userEvent.setup().click(detail.querySelector('summary')!)
  expect(detail).toHaveAttribute('open')
  expect(screen.getByText(activity.guidance)).toBeVisible()
  expect(screen.getByText(/termous.desktop_workflows.captures.create/)).toBeVisible()
  rerender(element({ ...activity, count: 6, status: 'progressed', guidance: '已经观察到有效变化。' }))
  expect(container.querySelectorAll('[data-progress-id]')).toHaveLength(1)
  expect(detail).toHaveAttribute('data-status', 'progressed')
  expect(screen.getByText('已经观察到有效变化。')).toBeVisible()
})
