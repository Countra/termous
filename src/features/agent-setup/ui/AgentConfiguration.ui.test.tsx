import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { defaultExecutionBudget } from '#common/contracts'
import type { AgentReadiness } from '#entities/agent'
import type { AgentSetupGateway } from '../api/agentSetupGateway'
import { AgentSettingsPanel } from './AgentSettingsPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture() {
  let readiness: AgentReadiness = {
    status: 'ready',
    mcp_runtime: { status: 'ready', message: '' }, mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' }, default_model: { status: 'ready', message: '' },
    mcp_policy: { client_id: 'test', approval_bypass: false, revision: 1, scope_count: 1,
      required_scope_count: 1, scope_sync_required: false },
    settings: { default_reasoning_level: 'off', show_turn_token_usage: true, revision: 1,
      global_context_window_tokens: 16_384, global_max_output_tokens: 4_096,
      max_concurrent_runs: 4, context_compaction_threshold_percent: 80, connect_ssh_profile_on_bind: false,
      execution_budget: defaultExecutionBudget },
  }
  const gateway = {
    readiness: vi.fn(async () => readiness),
    modelProviders: vi.fn(async () => ({ items: [] })), models: vi.fn(async () => ({ items: [] })),
    updateSettings: vi.fn<AgentSetupGateway['updateSettings']>(async input => {
      const { expected_revision, ...value } = input
      const settings = { ...readiness.settings, ...value, revision: expected_revision + 1 }
      readiness = { ...readiness, settings }
      return settings
    }),
    updateMcpPolicy: vi.fn<AgentSetupGateway['updateMcpPolicy']>(async input => {
      const policy = { ...readiness.mcp_policy!, approval_bypass: input.approval_bypass,
        revision: input.expected_revision + 1 }
      readiness = { ...readiness, mcp_policy: policy }
      return policy
    }),
  }
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}>
    <AgentSettingsPanel gateway={gateway as unknown as AgentSetupGateway} />
  </ConfigProvider>)
  return { gateway, view }
}

const save = () => screen.getByRole('button', { name: 'app.save' })
const threshold = () => screen.getByRole('spinbutton', { name: 'settings.agent.compaction.threshold' })

it('模型、行为和执行限制共用唯一保存入口，输入和失焦不提交', async () => {
  const { gateway } = fixture()
  await screen.findByRole('spinbutton', { name: 'settings.agent.compaction.threshold' })
  fireEvent.change(threshold(), { target: { value: '85' } })
  fireEvent.click(screen.getByRole('switch', { name: 'settings.agent.profileBinding.toggle' }))
  fireEvent.click(screen.getByRole('switch', { name: 'settings.agent.executionLimits.toggle' }))
  const budget = screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })
  fireEvent.change(budget, { target: { value: '200' } })
  fireEvent.blur(budget)
  expect(gateway.updateSettings).not.toHaveBeenCalled()
  expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: 'app.save' })).toHaveLength(1)
  fireEvent.click(save())
  await screen.findByText('settings.editor.saved')
  expect(gateway.updateSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    context_compaction_threshold_percent: 85, connect_ssh_profile_on_bind: true, expected_revision: 1,
    execution_budget: { enabled: true, limits: { ...defaultExecutionBudget.limits, model_requests: 200 } },
  }), expect.any(AbortSignal))
  expect(save()).toBeDisabled()
})

it('审批写入失败保留剩余草稿，重试仅写未完成资源，不重复提交已成功参数', async () => {
  const user = userEvent.setup()
  const { gateway } = fixture()
  gateway.updateMcpPolicy.mockRejectedValueOnce(new Error('policy unavailable'))
  await screen.findByRole('spinbutton', { name: 'settings.agent.compaction.threshold' })
  fireEvent.change(threshold(), { target: { value: '85' } })
  await user.click(screen.getByRole('switch', { name: 'settings.agent.policy.approval' }))
  expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(save())
  expect(gateway.updateSettings).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
  await screen.findByText('settings.agent.configuration.saveFailed')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5_000 })
  await waitFor(() => expect(save()).toBeEnabled())
  expect(threshold()).toHaveValue('85')
  expect(screen.getByRole('switch', { name: 'settings.agent.policy.approval' })).toBeChecked()
  expect(screen.queryByText('settings.editor.saved')).not.toBeInTheDocument()
  await user.click(save())
  await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
  await screen.findByText('settings.editor.saved')
  expect(gateway.updateSettings).toHaveBeenCalledTimes(1)
  expect(gateway.updateMcpPolicy).toHaveBeenCalledTimes(2)
  expect(gateway.updateMcpPolicy).toHaveBeenLastCalledWith({ approval_bypass: true,
    sync_scopes: false, expected_revision: 1 }, expect.any(AbortSignal))
})

it('参数保存失败不继续写审批策略，两部分草稿均保留', async () => {
  const user = userEvent.setup()
  const { gateway } = fixture()
  gateway.updateSettings.mockRejectedValueOnce(new Error('settings unavailable'))
  await screen.findByRole('spinbutton', { name: 'settings.agent.compaction.threshold' })
  fireEvent.change(threshold(), { target: { value: '85' } })
  await user.click(screen.getByRole('switch', { name: 'settings.agent.policy.approval' }))
  await user.click(save())
  await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
  await screen.findByText('settings.agent.configuration.saveFailed')
  expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
  expect(threshold()).toHaveValue('85')
  expect(screen.getByRole('switch', { name: 'settings.agent.policy.approval' })).toBeChecked()
})

it('参数请求期间卸载页面会中止请求，也不会继续写审批策略', async () => {
  const user = userEvent.setup()
  const { gateway, view } = fixture()
  let finish!: () => void
  gateway.updateSettings.mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ revision: 2 } as AgentReadiness['settings'])
  }))
  await screen.findByRole('spinbutton', { name: 'settings.agent.compaction.threshold' })
  fireEvent.change(threshold(), { target: { value: '85' } })
  await user.click(screen.getByRole('switch', { name: 'settings.agent.policy.approval' }))
  await user.click(save())
  await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
  await waitFor(() => expect(gateway.updateSettings).toHaveBeenCalledOnce())
  const signal = gateway.updateSettings.mock.calls[0][1]
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => finish())
  expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
})
