import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentReadiness } from '#entities/agent'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentRuntimeSettings } from './AgentRuntimeSettings.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const saveLabel = 'app.save'
const resetLabel = 'settings.editor.reset'
const thresholdLabel = 'settings.agent.compaction.threshold'

describe('AI 助手统一保存反馈', () => {
  it('运行检查期间阻止提交，但不误报正在保存', () => {
    const runtime = runtimeFixture()
    const view = render(<AgentRuntimeSettings runtime={runtime} />)
    view.rerender(<AgentRuntimeSettings runtime={{ ...runtime, loading: true }} />)
    expect(screen.getByText('settings.editor.processing')).toBeInTheDocument()
    expect(screen.queryByText('settings.editor.saving')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    expect(screen.getByRole('button', { name: saveLabel })).not.toHaveClass('ant-btn-loading')
  })

  it('撤销无效修改恢复保存值与校验，不发送请求', () => {
    const runtime = runtimeFixture()
    render(<AgentRuntimeSettings runtime={runtime} />)
    const threshold = screen.getByRole('spinbutton', { name: thresholdLabel })
    fireEvent.change(threshold, { target: { value: '49' } })
    expect(threshold).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('settings.editor.unsaved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: resetLabel }))
    expect(threshold).toHaveValue('80')
    expect(threshold).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: resetLabel })).toBeDisabled()
    expect(runtime.saveConfiguration).not.toHaveBeenCalled()
  })

  it('请求成功才播报已保存，后续编辑恢复未保存提示', async () => {
    const runtime = runtimeFixture()
    const saved = { ...runtime.readiness!.settings, context_compaction_threshold_percent: 85, revision: 2 }
    let complete!: (value: typeof saved) => void
    vi.mocked(runtime.saveConfiguration).mockImplementationOnce(() => new Promise((resolve) => { complete = value => resolve({ settings: value, policy: undefined }) }))
    const view = render(<AgentRuntimeSettings runtime={runtime} />)
    const threshold = screen.getByRole('spinbutton', { name: thresholdLabel })
    fireEvent.change(threshold, { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: saveLabel }))
    expect(screen.queryByText('settings.editor.saved')).not.toBeInTheDocument()
    await act(async () => {
      complete(saved)
      view.rerender(<AgentRuntimeSettings runtime={{ ...runtime, readiness: { ...runtime.readiness!, settings: saved } }} />)
    })
    await waitFor(() => expect(screen.getByText('settings.editor.saved')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    fireEvent.change(threshold, { target: { value: '90' } })
    expect(screen.getByText('settings.editor.unsaved')).toBeInTheDocument()
  })

  it('保存失败保留草稿且不误报成功，用户仍可重试', async () => {
    const runtime = runtimeFixture()
    vi.mocked(runtime.saveConfiguration).mockRejectedValueOnce(new Error('request failed'))
    render(<AgentRuntimeSettings runtime={runtime} />)
    const threshold = screen.getByRole('spinbutton', { name: thresholdLabel })
    fireEvent.change(threshold, { target: { value: '85' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: saveLabel })))
    expect(threshold).toHaveValue('85')
    expect(screen.getByText('settings.editor.unsaved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: saveLabel })).toBeEnabled()
    expect(screen.queryByText('settings.editor.saved')).not.toBeInTheDocument()
  })

  it('未编辑时跟随外部新版本，不把外部更新播报为本次保存', () => {
    const runtime = runtimeFixture()
    const view = render(<AgentRuntimeSettings runtime={runtime} />)
    const readiness = { ...runtime.readiness!, settings: { ...runtime.readiness!.settings, revision: 2, context_compaction_threshold_percent: 75 } }
    view.rerender(<AgentRuntimeSettings runtime={{ ...runtime, readiness }} />)
    expect(screen.getByRole('spinbutton', { name: thresholdLabel })).toHaveValue('75')
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    expect(screen.getByRole('button', { name: resetLabel })).toBeDisabled()
    expect(screen.queryByText('settings.editor.saved')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.agent.conflict.defaultsDescription')).not.toBeInTheDocument()
    expect(runtime.saveConfiguration).not.toHaveBeenCalled()
  })

  it('外部版本不覆盖脏草稿，撤销时采用最新已读配置而非旧基线', () => {
    const runtime = runtimeFixture()
    const view = render(<AgentRuntimeSettings runtime={runtime} />)
    const threshold = screen.getByRole('spinbutton', { name: thresholdLabel })
    fireEvent.change(threshold, { target: { value: '85' } })
    const readiness = { ...runtime.readiness!, settings: { ...runtime.readiness!.settings, revision: 2, context_compaction_threshold_percent: 75 } }
    view.rerender(<AgentRuntimeSettings runtime={{ ...runtime, readiness }} />)
    expect(threshold).toHaveValue('85')
    expect(screen.getByText('settings.agent.conflict.defaultsDescription')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: resetLabel }))
    expect(threshold).toHaveValue('75')
    expect(screen.queryByText('settings.agent.conflict.defaultsDescription')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: resetLabel })).toBeDisabled()
    expect(runtime.resolveConflict).not.toHaveBeenCalled()
    expect(runtime.saveConfiguration).not.toHaveBeenCalled()
  })

  it('冲突读取失败不报成功，成功后保留草稿并允许撤销到最新配置', async () => {
    const runtime = runtimeFixture()
    const view = render(<AgentRuntimeSettings runtime={runtime} />)
    const threshold = screen.getByRole('spinbutton', { name: thresholdLabel })
    fireEvent.change(threshold, { target: { value: '85' } })
    const conflicted = { ...runtime, conflict: { kind: 'configuration' as const } }
    view.rerender(<AgentRuntimeSettings runtime={conflicted} />)
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    vi.mocked(runtime.resolveConflict).mockResolvedValueOnce(null)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' })))
    expect(threshold).toHaveValue('85')
    expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
    const readiness = { ...runtime.readiness!, settings: { ...runtime.readiness!.settings, revision: 2, context_compaction_threshold_percent: 75 } }
    vi.mocked(runtime.resolveConflict).mockImplementationOnce(async () => {
      view.rerender(<AgentRuntimeSettings runtime={{ ...runtime, readiness }} />)
      return { readiness, providers: [], models: [] }
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' })))
    expect(threshold).toHaveValue('85')
    expect(screen.queryByText('settings.agent.conflict.defaultsDescription')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: saveLabel })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: resetLabel }))
    expect(threshold).toHaveValue('75')
    expect(runtime.saveConfiguration).not.toHaveBeenCalled()
  })
})

function runtimeFixture() {
  const readiness: AgentReadiness = {
    status: 'needs_setup',
    mcp_runtime: { status: 'ready', message: '' }, mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' }, default_model: { status: 'missing', message: '' },
    settings: {
      default_reasoning_level: 'off', show_turn_token_usage: true, revision: 1,
      global_context_window_tokens: 16_384, global_max_output_tokens: 4_096,
      max_concurrent_runs: 4,
      context_compaction_threshold_percent: 80,
      connect_ssh_profile_on_bind: false,
    },
  }
  return {
    readiness, providers: [], models: [], loading: false, mutation: null, conflict: null, error: null,
    saveConfiguration: vi.fn(), resolveConflict: vi.fn(), clearConfigurationFeedback: vi.fn(), load: vi.fn(), setup: vi.fn(),
  } as unknown as AgentSetupController
}
