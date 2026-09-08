import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessagePart, AgentRetryActivity, AgentRunEvent } from '#entities/agent'
import { i18n } from '#shared/i18n'
import { writeClipboardText } from '#shared/clipboard'
import { AgentConversation } from '../../../widgets/agent-workspace/ui/AgentConversation.tsx'
import { agentFixtureTime, agentMessageFixture, agentRunFixture, agentTextPartFixture } from '../../../features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

vi.mock('#shared/clipboard', () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }))

const failure = { attempt_id: 'attempt-one', error_message: '  <img src=x>\n[错误](https://example.invalid)\t原文  ' }
const retry: AgentRetryActivity = { retry_id: 'retry-one', assistant_message_id: 'agm-assistant', purpose: 'response',
  status: 'waiting', attempt: 0, max_retries: 3, delay_ms: 2_000, error_message: failure.error_message,
  after_part_sequence: 3, created_at: agentFixtureTime }

function parts(): AgentMessagePart[] {
  const base = agentTextPartFixture()
  return [
    { ...base, id: 'reasoning', sequence: 1, kind: 'reasoning', text: '保留思考', response_failure: failure },
    { ...base, id: 'failed-text', sequence: 2, text: '```js\n未完成的代码块', response_failure: failure },
    { ...base, id: 'failed-call', sequence: 3, kind: 'tool_call',
      tool_call: { tool_call_id: 'call-reused', tool_name: 'shell', arguments: { command: 'old' } }, response_failure: failure },
    { ...base, id: 'new-text', sequence: 4, text: '# 新回答' },
    { ...base, id: 'new-call', sequence: 5, kind: 'tool_call',
      tool_call: { tool_call_id: 'call-reused', tool_name: 'shell', arguments: { command: 'new' } } },
    { ...base, id: 'new-result', sequence: 6, kind: 'tool_result', response_failure: undefined,
      tool_result: { tool_call_id: 'call-reused', tool_name: 'shell', content: '新工具结果', is_error: false } },
  ]
}

describe('失败请求片段投影与展示', () => {
  it('同次失败的所有片段后仅放一条错误，再放重试活动和独立新回答', () => {
    const message = agentMessageFixture({ status: 'streaming', parts: parts(), retries: [retry] })
    const toolEvent: AgentRunEvent = { id: 'tool-event', run_id: 'agr-run', generation: 1, sequence: 1,
      kind: 'tool_completed', created_at: agentFixtureTime,
      payload: { tool: { tool_call_id: 'call-reused', tool_name: 'shell', duration_ms: 120 } } }
    const projected = projectAgentMessages([message], agentRunFixture(), [toolEvent])[0]!
    expect(projected.parts.map(({ kind }) => kind)).toEqual(['reasoning', 'text', 'tool', 'response_failure', 'retry', 'text', 'tool'])
    expect(projected.parts[0]).toMatchObject({ streaming: false })
    expect(projected.parts[2]).toMatchObject({ id: 'failed-call', status: 'failed', duration_ms: undefined })
    expect(projected.parts[2]?.kind === 'tool' && projected.parts[2].detail).not.toContain('新工具结果')
    expect(projected.parts[3]).toMatchObject({ failure, after_part_sequence: 3 })
    expect(projected.parts[6]).toMatchObject({ id: 'new-call', status: 'completed', duration_ms: 120 })
    expect(projected.parts[6]?.kind === 'tool' && projected.parts[6].detail).toContain('新工具结果')
  })

  it('历史和归档无需活动 Run 也保留失败边界，重复原文按不同 attempt 各显示一次', () => {
    const message = agentMessageFixture({ status: 'failed', parts: [
      agentTextPartFixture({ response_failure: failure }),
      agentTextPartFixture({ id: 'failed-two', sequence: 2, response_failure: { ...failure, attempt_id: 'attempt-two' } }),
    ] })
    const projected = projectAgentMessages([message], undefined, [])[0]!
    expect(projected.parts.map(({ kind }) => kind)).toEqual(['text', 'response_failure', 'text', 'response_failure'])
    expect(projected.parts.filter((part) => part.kind === 'response_failure').map(({ failure: item }) => item.attempt_id))
      .toEqual(['attempt-one', 'attempt-two'])
  })

  it('没有错误原文时仍停止失败思考和工具状态，不生成空错误行', () => {
    const failed = parts().slice(0, 3).map((part) => ({ ...part, response_failure: { ...failure, error_message: '' } })) as AgentMessagePart[]
    for (const status of ['running', 'waiting_approval', 'stopping'] as const) {
      const projected = projectAgentMessages([agentMessageFixture({ parts: failed })], agentRunFixture({ status }), [])[0]!
      expect(projected.parts.map(({ kind }) => kind)).toEqual(['reasoning', 'text', 'tool'])
      expect(projected.parts[0]).toMatchObject({ streaming: false })
      expect(projected.parts[2]).toMatchObject({ status: 'failed' })
    }
  })

  it('主动停止的历史保留半截回答和先前真实错误，取消片段不显示额外错误行', async () => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const message = agentMessageFixture({ status: 'interrupted', parts: [
      agentTextPartFixture({ text: '先前失败的半截回答', response_failure: failure }),
      agentTextPartFixture({ id: 'cancelled', sequence: 2, text: '主动停止的半截回答',
        response_failure: { attempt_id: 'attempt-cancelled', error_message: '' } }),
    ] })
    const view = render(<I18nextProvider i18n={localized}>
      <AgentConversation messages={projectAgentMessages([message], undefined, [])}
        runStatus="idle" loading={false} sessionKey="session" />
    </I18nextProvider>)
    expect(screen.getByText('先前失败的半截回答')).toBeVisible()
    expect(screen.getByText('主动停止的半截回答')).toBeVisible()
    expect(view.container.querySelectorAll('[data-response-attempt-id]')).toHaveLength(1)
    expect(view.container.querySelector('[data-response-attempt-id="attempt-one"]')?.textContent).toBe(failure.error_message)
    expect(screen.getByText(localized.t('agent.message.interrupted'))).toBeVisible()
  })

  it.each(['zh-CN', 'en-US'])('%s 保留全部纯文本错误，未闭合代码块不吞掉新回答，重试和底部错误不重复', async (language) => {
    const localized = i18n.cloneInstance({ lng: language })
    await localized.changeLanguage(language)
    const message = agentMessageFixture({ status: 'failed', parts: parts(),
      retries: [{ ...retry, status: 'failed', attempt: 3 }],
      turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage,
        error_code: 'AGENT_MODEL_PROVIDER_FAILED', error_message: failure.error_message } })
    const projected = projectAgentMessages([message], undefined, [])
    const view = render(<I18nextProvider i18n={localized}>
      <AgentConversation messages={projected} runStatus="idle" loading={false} sessionKey="archive:session" />
    </I18nextProvider>)
    const error = view.container.querySelector('[data-response-attempt-id="attempt-one"]')!
    expect(error.textContent).toBe(failure.error_message)
    expect(error).toBeVisible()
    expect(error).toHaveAttribute('aria-live', 'off')
    expect(error.querySelector('a, img, button, details')).toBeNull()
    expect(view.container.textContent?.split(failure.error_message)).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '新回答' })).toBeVisible()
    expect(view.container.querySelector('pre')).not.toHaveTextContent('新回答')
    expect(view.container.querySelector('[data-retry-id]')).toBeVisible()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: localized.t('app.copy') })) })
    expect(writeClipboardText).toHaveBeenLastCalledWith(['```js\n未完成的代码块', failure.error_message, '# 新回答'].join('\n\n'))
  })

  it('运行中也立即显示失败片段错误，重试原文不同时出现，成功后仍保留历史', async () => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const message = agentMessageFixture({ status: 'streaming', parts: parts().slice(0, 3), retries: [retry] })
    const element = (status: 'streaming' | 'completed') => <I18nextProvider i18n={localized}>
      <AgentConversation messages={projectAgentMessages([{ ...message, status }], undefined, [])}
        runStatus={status === 'streaming' ? 'running' : 'completed'} loading={false} sessionKey="session" />
    </I18nextProvider>
    const view = render(element('streaming'))
    expect(view.container.querySelector('[data-response-attempt-id]')).toBeVisible()
    expect(view.container.textContent?.split(failure.error_message)).toHaveLength(2)
    expect(view.container.querySelector('time')).toBeNull()
    view.rerender(element('completed'))
    expect(view.container.querySelector('[data-response-attempt-id]')).toBeVisible()
    expect(view.container.querySelector('time')).toBeVisible()
  })

  it('最后一次失败没有重试活动时仍按 attempt 保留错误，底部只显示失败说明', async () => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const message = agentMessageFixture({ status: 'failed', parts: [
      agentTextPartFixture({ response_failure: failure }),
      agentTextPartFixture({ id: 'last-failed', sequence: 2, response_failure: { ...failure, attempt_id: 'attempt-two' } }),
    ], turn_usage: { run_id: 'agr-run', usage: agentRunFixture().usage, error_message: failure.error_message } })
    const view = render(<I18nextProvider i18n={localized}>
      <AgentConversation messages={projectAgentMessages([message], undefined, [])} runStatus="failed" loading={false} sessionKey="session" />
    </I18nextProvider>)
    expect(view.container.querySelectorAll('[data-response-attempt-id]')).toHaveLength(2)
    expect(view.container.textContent?.split(failure.error_message)).toHaveLength(3)
    expect(screen.getByText(localized.t('agent.message.failed'))).toBeVisible()
  })
})
