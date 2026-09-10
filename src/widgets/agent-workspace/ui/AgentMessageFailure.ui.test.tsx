import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentConversation } from './AgentConversation.tsx'
import { AgentMessageFailure } from './AgentMessageFailure.tsx'

const failureCases = [
  ['AGENT_MODEL_STREAM_INTERRUPTED', '模型响应连接中断', 'model connection was interrupted'],
  ['AGENT_MODEL_TIMEOUT', '模型响应超时', 'model response timed out'],
  ['AGENT_MODEL_RATE_LIMITED', '请求过于频繁或额度受限', 'rate or quota limit'],
  ['AGENT_MODEL_AUTH_FAILED', '模型服务认证失败', 'rejected authentication'],
  ['AGENT_MODEL_CONTEXT_LIMIT', '超出了模型的上下文容量', 'exceeded the model context capacity'],
  ['AGENT_MODEL_PROVIDER_FAILED', '模型服务暂时无法完成请求', 'could not complete the request'],
  ['AGENT_MODEL_CONTENT_FILTERED', '内容策略阻止了本次回复', 'blocked this response under its content policy'],
  ['AGENT_MODEL_REQUEST_FAILED', '模型请求失败', 'model request failed'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_STREAM_INTERRUPTED', '生成上下文摘要时连接中断', 'connection was interrupted while generating the context summary'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_TIMEOUT', '生成上下文摘要超时', 'Generating the context summary timed out'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_RATE_LIMITED', '生成上下文摘要时触发模型服务限流或额度限制', 'rate or quota limit while generating the context summary'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_AUTH_FAILED', '生成上下文摘要时模型服务认证失败', 'rejected authentication while generating the context summary'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_CONTEXT_LIMIT', '生成上下文摘要的请求超出模型上下文容量', 'context summary request exceeded the model context capacity'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_PROVIDER_FAILED', '生成上下文摘要时模型服务发生错误', 'model service failed while generating the context summary'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_CONTENT_FILTERED', '内容策略阻止了上下文摘要生成', 'blocked context summary generation under its content policy'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_TRUNCATED', '上下文摘要被模型输出上限截断', 'context summary was truncated by the model output limit'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_CHECKPOINT_FAILED', '上下文摘要未能确认保存', 'Saving the context summary could not be confirmed'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_UNAVAILABLE', '当前没有可压缩的历史', 'no earlier history can be compacted'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_INSUFFICIENT', '压缩后仍没有足够的上下文空间', 'did not free enough context space'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_ABORTED', '上下文压缩已取消', 'Context compaction was cancelled'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_SETTINGS_INVALID', '容量配置无效', 'compaction budget is invalid'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_INVALID', '压缩结果或恢复状态无效', 'context or recovery state was invalid'],
  ['AGENT_RUNTIME_CONTEXT_COMPRESSION_FAILED', '上下文压缩未能完成', 'Context compaction could not finish'],
] as const

describe('AgentMessageFailure', () => {
  it.each([
    ['AGENT_MCP_PROTOCOL_MISMATCH', 'AI 助手与 MCP 工具服务的协议版本不兼容', 'The AI assistant and MCP tool service use incompatible protocol versions.'],
    ['AGENT_MCP_ENDPOINT_INVALID', 'AI 助手的 MCP 工具服务地址无效', 'The MCP tool service address is invalid.'],
    ['AGENT_MCP_ENDPOINT_VIOLATION', 'AI 助手的 MCP 工具服务地址不符合本地连接要求', 'The MCP tool service address does not meet local connection requirements.'],
    ['AGENT_MCP_TOOL_NAME_CONFLICT', 'MCP 工具名称重复或无效，AI 助手未能启动', 'MCP tool names are duplicated or invalid. The AI assistant could not start.'],
    ['AGENT_MCP_TOOL_SCHEMA_INVALID', 'MCP 工具参数定义无效，AI 助手未能启动', 'An MCP tool parameter definition is invalid. The AI assistant could not start.'],
    ['AGENT_MCP_TOOLS_EMPTY', 'MCP 工具服务没有返回可用工具，AI 助手未能启动', 'The MCP tool service returned no available tools. The AI assistant could not start.'],
    ['AGENT_MCP_CONNECTION_FAILED', 'AI 助手连接 MCP 工具服务失败，请准备或修复后重试', 'The AI assistant could not connect to the MCP tool service. Prepare or repair it, then try again.'],
  ])('MCP 启动错误 %s 用当前语言完整显示一次安全原因', async (error_code, chinese, english) => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const element = <I18nextProvider i18n={localized}>
      <AgentMessageFailure message={{ status: 'failed', error_code, error_message: chinese }} />
    </I18nextProvider>
    const view = render(element)
    expect(view.container.textContent).toBe(chinese)
    await localized.changeLanguage('en-US')
    view.rerender(element)
    expect(view.container.textContent).toBe(english)
  })

  it.each(failureCases)('用中英文显示 %s 的具体原因', async (error_code, chinese, english) => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const view = render(<I18nextProvider i18n={localized}><AgentMessageFailure message={{ status: 'failed', error_code }} /></I18nextProvider>)
    expect(view.container.textContent).toContain(chinese)
    await localized.changeLanguage('en-US')
    view.rerender(<I18nextProvider i18n={localized}><AgentMessageFailure message={{ status: 'failed', error_code }} /></I18nextProvider>)
    expect(view.container.textContent).toContain(english)
  })

  it.each(['AGENT_UNKNOWN_ERROR', 'constructor', '__proto__', 'agent.message.you'])('未知错误码 %s 保持通用失败文案', async (error_code) => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    render(<I18nextProvider i18n={localized}><AgentMessageFailure message={{ status: 'failed', error_code }} /></I18nextProvider>)
    expect(screen.getByText('本次回复失败')).toBeInTheDocument()
    expect(screen.queryByText(error_code)).not.toBeInTheDocument()
  })

  it.each(['AGENT_MODEL_STREAM_INTERRUPTED', 'AGENT_RUNTIME_CONTEXT_COMPRESSION_STREAM_INTERRUPTED'])('%s 会话失败行显示纯文本详情，不解析 HTML、Markdown 或翻译键', async (error_code) => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const detail = '<img src=x onerror=alert(1)>\n[详情](https://example.invalid) agent.message.you {{value}}'
    const message: AgentWorkspaceMessage = {
      id: 'assistant', role: 'assistant', status: 'failed', created_at: '2026-09-05T00:00:00Z',
      parts: [], attachments: [], error_code, error_message: detail,
    }
    const view = render(<I18nextProvider i18n={localized}>
      <AgentConversation messages={[message]} runStatus="failed" loading={false} sessionKey="session" />
    </I18nextProvider>)
    expect(view.container.textContent).toContain(error_code === 'AGENT_MODEL_STREAM_INTERRUPTED' ? '模型响应连接中断' : '生成上下文摘要时连接中断')
    expect(view.container.textContent).toContain(detail)
    expect(view.container.querySelector('img, a')).toBeNull()
  })

  it('中断语义保持不变，且不展示失败详情', async () => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const view = render(<I18nextProvider i18n={localized}>
      <AgentMessageFailure message={{ status: 'interrupted_by_steer', error_code: 'AGENT_MODEL_TIMEOUT', error_message: 'provider detail' }} />
    </I18nextProvider>)
    expect(view.container.textContent).toBe('已由新消息中断')
    expect(screen.queryByText('provider detail')).not.toBeInTheDocument()
  })

  it.each(['response', 'compaction'] as const)('%s 失败活动与最终错误原文相同时只显示一次，多行和首尾空白保持不变', async (purpose) => {
    const localized = i18n.cloneInstance({ lng: 'zh-CN' })
    await localized.changeLanguage('zh-CN')
    const detail = '  provider error\n请求被服务拒绝\nstatus 503  '
    const message: AgentWorkspaceMessage = {
      id: 'assistant', role: 'assistant', status: 'failed', created_at: '2026-09-08T00:00:00Z',
      error_message: detail, attachments: [],
      parts: [{ id: 'retry:one', kind: 'retry', activity: {
        retry_id: 'one', assistant_message_id: 'assistant', purpose, status: 'failed',
        attempt: 3, max_retries: 3, after_part_sequence: 0, delay_ms: 0, duration_ms: 7_000,
        error_message: detail, created_at: '2026-09-08T00:00:00Z',
      } }],
    }
    const element = (current: AgentWorkspaceMessage) => <I18nextProvider i18n={localized}>
      <AgentConversation messages={[current]} runStatus="failed" loading={false} sessionKey="session" />
    </I18nextProvider>
    const { container, rerender } = render(element(message))
    expect(container.textContent!.split(detail)).toHaveLength(2)
    expect(screen.getByText('本次回复失败')).toBeInTheDocument()
    rerender(element({ ...message, error_message: '不同的最终运行错误' }))
    expect(container.textContent).toContain(detail)
    expect(screen.getByText('不同的最终运行错误')).toBeInTheDocument()
  })
})
