import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import type { AgentWorkspaceContextState, AgentWorkspaceInspectorState } from '../model/types.ts'
import { AgentInspector } from './AgentInspector.tsx'

const context: AgentWorkspaceContextState = {
  phase: 'ready', has_snapshot: true, used_tokens: 0, context_window_tokens: 200_000,
  estimated: true, warning: false, compression_available: false, compression_pending: false,
  assessment: 'pending', compression_status: 'unknown',
}

describe('AgentInspector 模型上下文评估', () => {
  it('待评估只显示当前容量和原模型参考，不将原占用除以新窗口，也不渲染旧预警', async () => {
    await renderInspector({ ...context, warning: true, last_snapshot: {
      model_id: 'apm-old', model_name: 'GPT', estimated_tokens: 75_000, context_window_tokens: 100_000,
      basis: 'provider_usage',
    } })
    expect(screen.getByRole('status')).toHaveTextContent('当前模型待评估')
    expect(screen.getByRole('status')).toHaveTextContent('当前模型窗口：200k token')
    expect(screen.getByRole('status')).toHaveTextContent('上次 GPT：75% · 75,000 / 100,000 token')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('38%')).not.toBeInTheDocument()
    expect(screen.queryByText('上下文占用较高；达到整理阈值时，将在下一次请求前自动整理上下文。')).not.toBeInTheDocument()
  })

  it('未知能力在加载与错误状态允许键盘预约，明确不可用才禁用', async () => {
    const { change, rerender, element } = await renderInspector({ ...context, phase: 'loading', has_snapshot: false,
      assessment: undefined, compression_status: undefined })
    const control = screen.getByRole('switch')
    expect(control).toBeEnabled()
    control.focus()
    await userEvent.setup().keyboard(' ')
    expect(change).toHaveBeenCalledWith(true)
    rerender(element({ ...context, phase: 'loading' }))
    expect(screen.getByRole('switch')).toBeEnabled()
    rerender(element({ ...context, phase: 'error', compression_pending: true }))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByRole('switch')).toBeEnabled()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    rerender(element({ ...context, assessment: 'ready', compression_status: 'unavailable' }))
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByText('当前上下文暂不支持整理')).toBeInTheDocument()
  })

  it('待评估缺少上次快照时不假造零占用；英文参考使用原窗口', async () => {
    const { rerender, element } = await renderInspector(context, 'en-US')
    expect(screen.getByRole('status')).toHaveTextContent('Current model awaiting assessment')
    expect(screen.queryByText(/Last /)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('%')
    rerender(element({ ...context, last_snapshot: { model_id: 'apm-old', model_name: 'GPT', estimated_tokens: 0, context_window_tokens: 100_000 } }))
    expect(screen.getByRole('status')).toHaveTextContent('Last GPT: 0% · 0 / 100,000 tokens')
  })

  it('已评估按实际来源显示说明，并保留旧 Core 的估算标签', async () => {
    const ready = { ...context, assessment: 'ready' as const, used_tokens: 75_000, context_window_tokens: 100_000 }
    const { rerender, element } = await renderInspector({ ...ready, basis: 'provider_usage' })
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('模型用量校准')).toBeInTheDocument()
    expect(screen.getByText('根据模型返回的用量和后续新增内容估算。')).toBeInTheDocument()
    rerender(element({ ...ready, basis: 'pi_estimate' }))
    expect(screen.getByText('内容估算')).toBeInTheDocument()
    rerender(element({ ...ready, assessment: undefined, compression_status: undefined }))
    expect(screen.getByText('估算用量')).toBeInTheDocument()
  })
})

async function renderInspector(value: AgentWorkspaceContextState, language = 'zh-CN') {
  const localized = i18n.cloneInstance({ lng: language })
  await localized.changeLanguage(language)
  const change = vi.fn()
  const inspector: Omit<AgentWorkspaceInspectorState, 'context'> = {
    usage: { phase: 'unavailable', has_snapshot: false, run_count: 0, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 0, estimated: false },
    skills: [], mcp: { connection: 'on_demand', scope_count: 0 },
  }
  const element = (value: AgentWorkspaceContextState) => (
    <I18nextProvider i18n={localized}><AgentInspector inspector={{ ...inspector, context: value }} disabled={false}
      onContextCompressionPendingChange={change} onClose={() => {}} onRetryContext={() => {}} onRetryUsage={() => {}} />
    </I18nextProvider>
  )
  return { ...render(element(value)), element, change }
}
