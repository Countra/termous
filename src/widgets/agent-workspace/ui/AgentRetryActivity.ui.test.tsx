import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import type { AgentRetryActivity as Activity } from '#entities/agent'
import { i18n } from '#shared/i18n'
import { AgentRetryActivity } from './AgentRetryActivity.tsx'
import { AgentConversation } from './AgentConversation.tsx'
import type { AgentWorkspaceMessage } from '../model/types.ts'

const activity: Activity = {
  retry_id: 'retry-one', assistant_message_id: 'assistant-one', purpose: 'response',
  status: 'waiting', attempt: 0, max_retries: 3, delay_ms: 2_000,
  error_message: '  <img src=x>\n[details](https://example.invalid)\nagent.message.you {{value}}  ',
  after_part_sequence: 0, created_at: '2026-09-08T00:00:00Z',
}

describe('AgentRetryActivity', () => {
  it('等待显示下一次重试计数和固定等待时长，实际请求原位更新且不重复渲染', async () => {
    const { rerender, element, container } = await renderActivity(activity)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('等待重连 · 第1/3次')
    expect(status).toHaveTextContent('2 秒后重试')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(container.querySelector('svg.lucide-wifi')).toHaveAttribute('width', '14')
    rerender(element({ ...activity, status: 'requesting', attempt: 1 }))
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('正在重连 · 第1/3次')
    expect(status).not.toHaveTextContent('2 秒后重试')
    expect(container.querySelectorAll('[data-retry-id]')).toHaveLength(1)
    rerender(element({ ...activity, attempt: 1, delay_ms: 4_000 }))
    expect(status).toHaveTextContent('第2/3次')
    expect(status).toHaveTextContent('4 秒后重试')
  })

  it('原始错误保持换行且默认两行，可通过键盘展开，不解析 HTML 和 Markdown', async () => {
    const { container } = await renderActivity(activity)
    const toggle = screen.getByRole('button', { name: '展开错误详情' })
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(details.textContent).toBe(activity.error_message)
    expect(details.className).toContain('clamped')
    expect(container.querySelector('img, a')).toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const user = userEvent.setup()
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(details.className).not.toContain('clamped')
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('恢复时默认收起最后错误，终态显示实际次数和耗时，可再次查看原文', async () => {
    const { rerender, element, container } = await renderActivity(activity)
    await userEvent.setup().click(screen.getByRole('button'))
    rerender(element({ ...activity, status: 'completed', attempt: 1, duration_ms: 2_400 }))
    expect(screen.getByRole('status')).toHaveTextContent('重连成功')
    expect(screen.getByRole('status')).toHaveTextContent('已重试 1 次')
    expect(screen.getByRole('status')).toHaveTextContent('2.4 s')
    expect(container.textContent).not.toContain(activity.error_message)
    const toggle = screen.getByRole('button', { name: '查看最后一次错误' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.setup().click(toggle)
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.textContent).toBe(activity.error_message)
  })

  it.each(['failed', 'cancelled'] as const)('%s 保留真实零次请求和零耗时，摘要请求用途明确', async (status) => {
    await renderActivity({ ...activity, status, purpose: 'compaction', duration_ms: 0 })
    expect(screen.getByRole('status')).toHaveTextContent(status === 'failed' ? '重连失败' : '重连已取消')
    expect(screen.getByRole('status')).toHaveTextContent('摘要请求')
    expect(screen.getByRole('status')).toHaveTextContent('已重试 0 次')
    expect(screen.getByRole('status')).toHaveTextContent('0 ms')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('英文只翻译界面，保留服务原始错误语言', async () => {
    const error_message = '服务暂不可用\n请稍后重试'
    const { rerender, element, container } = await renderActivity({ ...activity, purpose: 'compaction', error_message }, 'en-US')
    expect(screen.getByRole('status')).toHaveTextContent('Waiting to reconnect · 1/3')
    expect(screen.getByRole('status')).toHaveTextContent('Summary request')
    expect(container.textContent).toContain(error_message)
    rerender(element({ ...activity, status: 'failed', attempt: 3, error_message, duration_ms: 10_000 }))
    expect(screen.getByRole('status')).toHaveTextContent('3 retries made')
  })

  it('对话活动替代空回复占位，同一行请求状态改变时保留展开状态', async () => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const message: AgentWorkspaceMessage = { id: 'assistant-one', role: 'assistant', status: 'streaming',
      created_at: activity.created_at, parts: [{ id: 'retry:retry-one', kind: 'retry', activity }], attachments: [] }
    const element = (current: AgentWorkspaceMessage) => <I18nextProvider i18n={localized}>
      <AgentConversation messages={[current]} runStatus="running" loading={false} sessionKey="session" />
    </I18nextProvider>
    const { rerender, container } = render(element(message))
    expect(screen.queryByText('正在回复')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: '展开错误详情' }))
    rerender(element({ ...message, parts: [{ id: 'retry:retry-one', kind: 'retry',
      activity: { ...activity, status: 'requesting', attempt: 1 } }] }))
    expect(screen.getByRole('button', { name: '收起错误详情' })).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelectorAll('[data-retry-id]')).toHaveLength(1)
  })
})

async function renderActivity(value: Activity, language = 'zh-CN') {
  const localized = i18n.cloneInstance({ lng: language })
  await localized.changeLanguage(language)
  const element = (current: Activity) => <I18nextProvider i18n={localized}><AgentRetryActivity activity={current} /></I18nextProvider>
  return { ...render(element(value)), element }
}
