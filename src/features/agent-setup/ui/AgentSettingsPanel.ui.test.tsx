import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModel, AgentModelProvider, AgentReadiness, AgentSettings } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { AgentSettingsPanel } from './AgentSettingsPanel.tsx'

describe('AgentSettingsPanel', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('首次进入设置时不自动聚焦 Provider 表单', async () => {
    renderPanel(gatewayFixture())

    const providerName = await screen.findByLabelText('settings.agent.providerEditor.name')
    expect(providerName).not.toHaveFocus()
  })

  it('用户主动新增 Provider 时把焦点移入名称字段且不滚动页面', async () => {
    const user = userEvent.setup()
    renderPanel(gatewayFixture({ providers: [providerFixture()] }))
    await screen.findByDisplayValue('Provider')

    await user.click(screen.getByRole('button', { name: 'settings.agent.providers.add' }))

    await waitFor(() => expect(screen.getByLabelText('settings.agent.providerEditor.name')).toHaveFocus())
  })

  it('Provider 新增与编辑在统一连接表单内配置 API Key', async () => {
    renderPanel(gatewayFixture({ providers: [providerFixture(1, true)] }))

    const connectionSection = (await screen.findByText(
      'settings.agent.providerEditor.connectionSection',
    )).closest('section')
    expect(connectionSection).not.toBeNull()
    expect(within(connectionSection!).getByLabelText(
      'settings.agent.providerEditor.optionalApiKey',
    )).toBeInTheDocument()
    expect(within(connectionSection!).getByText('settings.agent.apiKey.configured')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('无需确认策略必须先二次确认', async () => {
    const user = userEvent.setup()
    const gateway = gatewayFixture()
    renderPanel(gateway)
    await screen.findByText('settings.agent.providers.empty')

    await user.click(screen.getByRole('switch', { name: 'settings.agent.policy.approval' }))
    expect(screen.getByText('settings.agent.confirmBypass.description')).toBeInTheDocument()
    expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
    await waitFor(() => expect(gateway.updateMcpPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ approval_bypass: true }), expect.any(AbortSignal),
    ))
  })

  it('保存每轮 Token 展示设置时完整提交当前设置并禁用开关', async () => {
    const user = userEvent.setup()
    const readiness = readinessFixture(7, 'apm-1')
    const updatedSettings: AgentSettings = {
      ...readiness.settings,
      show_turn_token_usage: false,
      revision: 8,
    }
    const pending = deferred<AgentSettings>()
    const gateway = gatewayFixture({ readiness })
    vi.mocked(gateway.updateSettings).mockReturnValue(pending.promise)
    vi.mocked(gateway.readiness)
      .mockResolvedValueOnce(readiness)
      .mockResolvedValue({ ...readiness, settings: updatedSettings })
    renderPanel(gateway)

    const toggle = await screen.findByRole('switch', { name: 'settings.agent.turnUsage.toggle' })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await waitFor(() => expect(gateway.updateSettings).toHaveBeenCalledWith({
      default_model_id: 'apm-1',
      default_reasoning_level: 'off',
      global_context_window_tokens: 16_384,
      global_max_output_tokens: 4_096,
      show_turn_token_usage: false,
      expected_revision: 7,
    }, expect.any(AbortSignal)))
    expect(toggle).toBeDisabled()

    pending.resolve(updatedSettings)
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
  })

  it('全局默认参数独立保存并只用模型 ID 展示默认模型', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = {
      ...modelFixture(),
      supports_reasoning: false,
      reasoning_control: 'none' as const,
      supported_reasoning_levels: ['off' as const],
    }
    const gateway = gatewayFixture({
      providers: [provider], models: [model], readiness: readinessFixture(1, model.id),
    })
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    const defaultModelField = screen.getByText('settings.agent.defaults.model')
      .closest('[data-agent-default-field]')
    expect(defaultModelField).toHaveTextContent(model.remote_model_id)
    expect(defaultModelField).not.toHaveTextContent(model.display_name)
    expect(defaultModelField).not.toHaveTextContent(provider.name)
    const reasoningField = screen.getByText('settings.agent.defaults.reasoning')
      .closest<HTMLElement>('[data-agent-default-field]')!
    const reasoning = within(reasoningField).getByRole('combobox')
    await user.click(reasoning)
    const high = await screen.findByText('settings.agent.reasoning.high')
    expect(high.closest('.ant-select-item-option')).not.toHaveClass('ant-select-item-option-disabled')
    await user.click(high)
    fireEvent.change(screen.getByRole('spinbutton', {
      name: /settings\.agent\.defaults\.contextBudget/,
    }), { target: { value: '32768' } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.defaults.save' }))

    await waitFor(() => expect(gateway.updateSettings).toHaveBeenCalledWith({
      default_model_id: model.id,
      default_reasoning_level: 'high',
      global_context_window_tokens: 32_768,
      global_max_output_tokens: 4_096,
      show_turn_token_usage: true,
      expected_revision: 1,
    }, expect.any(AbortSignal)))
  })

  it('Token 快捷档位只更新草稿并在保存时提交精确值', async () => {
    const user = userEvent.setup()
    const model = modelFixture()
    const gateway = gatewayFixture({
      providers: [providerFixture()],
      models: [model],
      readiness: readinessFixture(1, model.id),
    })
    renderPanel(gateway)
    await screen.findByDisplayValue('Provider')

    await user.click(screen.getByRole('button', {
      name: 'settings.agent.defaults.contextQuickSelect',
    }))
    await user.click(await screen.findByText('64K'))
    await user.click(screen.getByRole('button', {
      name: 'settings.agent.defaults.outputQuickSelect',
    }))
    await user.click(await screen.findByText('8K'))

    expect(gateway.updateSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })).toHaveValue('65536')
    expect(screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.maxOutput',
    })).toHaveValue('8192')

    await user.click(screen.getByRole('button', { name: 'settings.agent.defaults.save' }))
    await waitFor(() => expect(gateway.updateSettings).toHaveBeenCalledWith({
      default_model_id: model.id,
      default_reasoning_level: 'off',
      global_context_window_tokens: 65_536,
      global_max_output_tokens: 8_192,
      show_turn_token_usage: true,
      expected_revision: 1,
    }, expect.any(AbortSignal)))
  })

  it('保留任意自定义 Token 值并阻止输出上限超过上下文窗口', async () => {
    const model = modelFixture()
    const gateway = gatewayFixture({
      providers: [providerFixture()],
      models: [model],
      readiness: readinessFixture(1, model.id),
    })
    renderPanel(gateway)
    await screen.findByDisplayValue('Provider')

    const contextInput = screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })
    const outputInput = screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.maxOutput',
    })
    fireEvent.change(contextInput, { target: { value: '50000' } })
    fireEvent.change(outputInput, { target: { value: '50001' } })

    expect(contextInput).toHaveValue('50000')
    expect(outputInput).toHaveValue('50001')
    expect(screen.getByText('settings.agent.validation.tokenLimit')).toBeInTheDocument()
    expect(outputInput).toHaveAttribute('aria-invalid', 'true')
    const errorId = outputInput.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent('settings.agent.validation.tokenLimit')
    expect(screen.getByRole('button', { name: 'settings.agent.defaults.save' })).toBeDisabled()
    expect(gateway.updateSettings).not.toHaveBeenCalled()
  })

  it('读取新 revision 后保留默认参数草稿并按新基线保存', async () => {
    const user = userEvent.setup()
    const model = modelFixture()
    const initial = readinessFixture(1, model.id)
    const latest: AgentReadiness = {
      ...initial,
      settings: {
        ...initial.settings,
        global_context_window_tokens: 65_536,
        revision: 2,
        updated_at: '2026-08-30T00:01:00Z',
      },
    }
    const saved: AgentSettings = {
      ...latest.settings,
      global_context_window_tokens: 32_768,
      revision: 3,
      updated_at: '2026-08-30T00:02:00Z',
    }
    const gateway = gatewayFixture({
      providers: [providerFixture()], models: [model], readiness: initial,
    })
    vi.mocked(gateway.setup).mockResolvedValue(latest)
    vi.mocked(gateway.readiness).mockResolvedValueOnce(initial).mockResolvedValue(latest)
    vi.mocked(gateway.updateSettings).mockResolvedValue(saved)
    renderPanel(gateway)
    await screen.findByDisplayValue('Provider')

    const contextInput = screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })
    fireEvent.change(contextInput, { target: { value: '32768' } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.checkAgain' }))

    expect(await screen.findByText('settings.agent.conflict.defaultsDescription')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })).toHaveValue('32768')
    await user.click(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' }))
    expect(screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })).toHaveValue('32768')

    await user.click(screen.getByRole('button', { name: 'settings.agent.defaults.save' }))
    await waitFor(() => expect(gateway.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        global_context_window_tokens: 32_768,
        expected_revision: 2,
      }),
      expect.any(AbortSignal),
    ))
  })

  it('默认参数 revision 冲突只显示一个恢复入口并一次保留草稿', async () => {
    const user = userEvent.setup()
    const model = modelFixture()
    const initial = readinessFixture(1, model.id)
    const latest: AgentReadiness = {
      ...initial,
      settings: {
        ...initial.settings,
        global_context_window_tokens: 65_536,
        revision: 2,
        updated_at: '2026-08-30T00:01:00Z',
      },
    }
    const saved: AgentSettings = {
      ...latest.settings,
      global_context_window_tokens: 32_768,
      revision: 3,
      updated_at: '2026-08-30T00:02:00Z',
    }
    const gateway = gatewayFixture({
      providers: [providerFixture()], models: [model], readiness: initial,
    })
    vi.mocked(gateway.readiness).mockResolvedValueOnce(initial).mockResolvedValue(latest)
    vi.mocked(gateway.updateSettings)
      .mockRejectedValueOnce(new TermousApiError(
        'revision conflict',
        'AGENT_REVISION_CONFLICT',
        409,
      ))
      .mockResolvedValue(saved)
    renderPanel(gateway)
    await screen.findByDisplayValue('Provider')

    const contextInput = screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })
    fireEvent.change(contextInput, { target: { value: '32768' } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.defaults.save' }))

    expect(await screen.findByText('settings.agent.conflict.defaultsDescription')).toBeInTheDocument()
    expect(screen.queryByText('settings.agent.conflict.description')).not.toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: 'settings.agent.conflict.refresh' })
    await waitFor(() => expect(refresh).toBeEnabled())
    await user.click(refresh)
    await waitFor(() => expect(screen.queryByText(
      'settings.agent.conflict.defaultsDescription',
    )).not.toBeInTheDocument())
    expect(screen.getByRole('spinbutton', {
      name: 'settings.agent.defaults.contextBudget',
    })).toHaveValue('32768')

    await user.click(screen.getByRole('button', { name: 'settings.agent.defaults.save' }))
    await waitFor(() => expect(gateway.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        global_context_window_tokens: 32_768,
        expected_revision: 2,
      }),
      expect.any(AbortSignal),
    ))
  })

  it('默认模型候选项的 hover 详情显示在下拉层上方', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = modelFixture()
    renderPanel(gatewayFixture({ providers: [provider], models: [model] }))
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('combobox', { name: 'settings.agent.defaults.model' }))
    const modelLabels = await screen.findAllByText(model.remote_model_id)
    const optionLabel = modelLabels.find((element) => element.closest('.ant-select-item-option'))
    expect(optionLabel).toBeDefined()
    await user.hover(optionLabel!)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(model.remote_model_id)
    expect(tooltip).toHaveTextContent('settings.agent.defaults.modelDetail')
    expect(tooltip.closest('.ant-tooltip')).toHaveStyle({ zIndex: '3600' })
    expect(optionLabel!.parentElement?.getAttribute('aria-label'))
      .toContain('settings.agent.defaults.modelDetail')
  })

  it('未编辑全局参数时自动吸收模型目录切换的默认项', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const first = modelFixture()
    const second = {
      ...modelFixture(),
      id: 'apm-2',
      remote_model_id: 'gpt-second',
      display_name: 'GPT Second',
    }
    const initial = readinessFixture(1, first.id)
    const updated = {
      ...initial,
      settings: {
        ...initial.settings,
        default_model_id: second.id,
        revision: 2,
        updated_at: '2026-08-30T00:01:00Z',
      },
    }
    const gateway = gatewayFixture({
      providers: [provider], models: [first, second], readiness: initial,
    })
    vi.mocked(gateway.updateSettings).mockResolvedValue(updated.settings)
    vi.mocked(gateway.readiness).mockResolvedValueOnce(initial).mockResolvedValue(updated)
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    const modelActions = screen.getAllByRole('button', {
      name: 'settings.agent.catalog.moreActions',
    })
    await user.click(modelActions[1]!)
    await user.click(await screen.findByRole('menuitem', {
      name: 'settings.agent.catalog.setDefault',
    }))

    const defaultModelField = screen.getByText('settings.agent.defaults.model')
      .closest('[data-agent-default-field]')
    await waitFor(() => expect(defaultModelField).toHaveTextContent(second.remote_model_id))
    expect(screen.queryByText('settings.agent.conflict.defaultsDescription')).not.toBeInTheDocument()
  })

  it('Provider、模型目录和默认模型选择提供可搜索语义', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = modelFixture()
    const gateway = gatewayFixture({ providers: [provider], models: [model] })
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    expect(screen.getByRole('textbox', { name: 'settings.agent.providers.search' })).toBeInTheDocument()
    const modelSelect = screen.getByRole('combobox', { name: 'settings.agent.defaults.model' })
    expect(modelSelect).not.toHaveAttribute('readonly')

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    expect(screen.getByRole('textbox', { name: 'settings.agent.catalog.search' })).toBeInTheDocument()
    await user.click(modelSelect)
    await user.type(modelSelect, model.remote_model_id)
    expect(modelSelect).toHaveValue(model.remote_model_id)
  })

  it('编辑态内联 API Key 使用 UTF-8 字节上限并可撤销草稿', async () => {
    const user = userEvent.setup()
    const gateway = gatewayFixture({ providers: [providerFixture(1, true)] })
    renderPanel(gateway)
    const input = await screen.findByLabelText('settings.agent.providerEditor.optionalApiKey')

    fireEvent.change(input, { target: { value: '密'.repeat(5462) } })
    expect(screen.getByText('settings.agent.apiKey.tooLarge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()

    fireEvent.change(input, { target: { value: 'one-time-secret' } })
    expect(screen.getByText('settings.agent.apiKey.replacePending')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.agent.providerEditor.reset' }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(document.body.textContent).not.toContain('one-time-secret')
  })

  it('首次配置 API Key 使用新增语义而不是替换语义', async () => {
    renderPanel(gatewayFixture({ providers: [providerFixture()] }))
    const input = await screen.findByLabelText('settings.agent.providerEditor.optionalApiKey')

    fireEvent.change(input, { target: { value: 'first-secret' } })

    expect(screen.getByText('settings.agent.apiKey.addPending')).toBeInTheDocument()
    expect(screen.queryByText('settings.agent.apiKey.replacePending')).not.toBeInTheDocument()
  })

  it('Provider 和密钥已保存但目录刷新失败时切换到权威编辑态并清除密钥', async () => {
    const user = userEvent.setup()
    const created = providerFixture(1, true, 'stale')
    const failed = { ...providerFixture(2, true, 'stale'), last_refresh_error_code: 'authentication_failed' }
    const gateway = gatewayFixture()
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [failed] })
    vi.mocked(gateway.createModelProvider).mockResolvedValue(created)
    vi.mocked(gateway.refreshProviderModels).mockResolvedValue(failed)
    renderPanel(gateway)
    await screen.findByText('settings.agent.providers.empty')

    fireEvent.change(screen.getByLabelText('settings.agent.providerEditor.name'), { target: { value: 'Provider' } })
    fireEvent.change(screen.getByLabelText('settings.agent.providerEditor.optionalApiKey'), { target: { value: 'one-time-secret' } })
    await user.click(screen.getByRole('button', { name: 'app.create' }))

    expect(await screen.findAllByText('settings.agent.providerEditor.provisionFailure.refresh.title'))
      .not.toHaveLength(0)
    expect(screen.getByLabelText('settings.agent.providerEditor.optionalApiKey')).toHaveValue('')
    expect(screen.getByLabelText('settings.agent.providerEditor.name')).toHaveValue('Provider')
    expect(gateway.createModelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: 'one-time-secret' }), expect.any(AbortSignal),
    )
    expect(document.body.textContent).not.toContain('one-time-secret')
  })

  it('编辑 Provider 与密钥成功但目录同步失败时回到权威状态并释放明文', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1, false, 'ready')
    const saved = providerFixture(2, true, 'stale')
    const failed = { ...providerFixture(3, true, 'stale'), last_refresh_error_code: 'authentication_failed' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(saved)
    vi.mocked(gateway.refreshProviderModels).mockResolvedValue(failed)
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [original] }).mockResolvedValue({ items: [failed] })
    renderPanel(gateway)
    await screen.findByDisplayValue(original.name)

    const input = screen.getByLabelText('settings.agent.providerEditor.optionalApiKey')
    fireEvent.change(input, { target: { value: 'one-time-secret' } })
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(gateway.updateModelProvider).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ api_key: 'one-time-secret', expected_revision: original.revision }),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(screen.getByLabelText(
      'settings.agent.providerEditor.optionalApiKey',
    )).toHaveValue(''))
    expect(document.body.textContent).not.toContain('one-time-secret')
  })

  it('已保存 API Key 在表单中标记删除、撤销并随统一保存提交', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1, true, 'ready')
    const unkeyed = providerFixture(2, false, 'stale')
    const refreshed = providerFixture(3, false, 'ready')
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(unkeyed)
    vi.mocked(gateway.refreshProviderModels).mockResolvedValue(refreshed)
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [original] }).mockResolvedValue({ items: [refreshed] })
    renderPanel(gateway)
    await screen.findByDisplayValue(original.name)

    await user.click(screen.getByRole('button', { name: 'settings.agent.apiKey.remove' }))
    expect(screen.getByText('settings.agent.apiKey.removePendingHint')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.agent.apiKey.undoRemove' }))
    expect(screen.queryByText('settings.agent.apiKey.removePendingHint')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.agent.apiKey.remove' }))
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(gateway.updateModelProvider).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ remove_api_key: true, expected_revision: original.revision }),
      expect.any(AbortSignal),
    ))
  })

  it('Provider 保存后以服务端规范化字段重置编辑草稿', async () => {
    const user = userEvent.setup()
    const original = providerFixture()
    const normalized = { ...providerFixture(2), name: 'Canonical Provider' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(normalized)
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [original] }).mockResolvedValue({ items: [normalized] })
    renderPanel(gateway)
    const input = await screen.findByDisplayValue(original.name)

    fireEvent.change(input, { target: { value: '  Draft Provider  ' } })
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(screen.getByLabelText('settings.agent.providerEditor.name')).toHaveValue(normalized.name))
  })

  it('未修改的 Provider 表单随服务端新 revision 自动同步', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1)
    const external = { ...providerFixture(2), name: 'Server Provider' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValue({ items: [external] })
    renderPanel(gateway)
    await screen.findByDisplayValue(original.name)

    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByDisplayValue(external.name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
  })

  it('脏草稿遇到服务端新 revision 时必须显式确认后才按新基线保存', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1)
    const external = { ...providerFixture(2), name: 'Server Provider' }
    const saved = { ...providerFixture(3), name: 'Draft Provider' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValueOnce({ items: [external] })
      .mockResolvedValue({ items: [saved] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(saved)
    renderPanel(gateway)
    const input = await screen.findByDisplayValue(original.name)

    fireEvent.change(input, { target: { value: saved.name } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.editorDescription')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(gateway.updateModelProvider).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' }))
    expect(await screen.findByText('settings.agent.conflict.draftPreserved')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(gateway.updateModelProvider).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ name: saved.name, expected_revision: external.revision }),
      expect.any(AbortSignal),
    ))
  })

  it('编辑中的 Provider 被外部删除后保留草稿直到用户确认离开', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1)
    const fallback = {
      ...providerFixture(1),
      id: 'apv-2',
      name: 'Provider B',
      base_url: 'https://provider-b.example.test/v1',
    }
    const gateway = gatewayFixture({ providers: [original, fallback] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original, fallback] })
      .mockResolvedValue({ items: [fallback] })
    renderPanel(gateway)
    const name = await screen.findByDisplayValue(original.name)
    const apiKey = screen.getByLabelText('settings.agent.providerEditor.optionalApiKey')

    fireEvent.change(name, { target: { value: 'Local draft' } })
    fireEvent.change(apiKey, { target: { value: 'draft-secret' } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.providerDeleted')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.providerEditor.name')).toHaveValue('Local draft')
    expect(screen.getByLabelText('settings.agent.providerEditor.optionalApiKey')).toHaveValue('draft-secret')

    await user.click(screen.getByRole('button', { name: /Provider B/ }))
    expect(screen.getByText('settings.agent.providers.discardDescription')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.providerEditor.optionalApiKey')).toHaveValue('draft-secret')
    const discardDialog = screen.getByText('settings.agent.providers.discardDescription')
      .closest<HTMLElement>('[role="dialog"]')
    expect(discardDialog).not.toBeNull()
    await user.click(within(discardDialog!).getByRole('button', {
      name: 'settings.agent.providers.discard',
    }))

    expect(await screen.findByDisplayValue(fallback.name)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('draft-secret')
  })

  it('Provider 删除 revision 冲突后关闭确认框并要求重新发起操作', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1)
    const refreshed = providerFixture(2)
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValue({ items: [refreshed] })
    vi.mocked(gateway.deleteModelProvider).mockRejectedValue(
      new TermousApiError('revision conflict', 'AGENT_REVISION_CONFLICT', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(original.name)

    await user.click(screen.getByRole('button', { name: 'app.delete' }))
    const description = await screen.findByText('settings.agent.confirmDelete.description')
    const dialog = description.closest<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    await user.click(within(dialog!).getByRole('button', { name: 'app.delete' }))

    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'))
    expect(await screen.findByText('settings.agent.conflict.description')).toBeInTheDocument()
    expect(gateway.deleteModelProvider).toHaveBeenCalledTimes(1)
    expect(gateway.deleteModelProvider).toHaveBeenCalledWith(
      original.id, original.revision, expect.any(AbortSignal),
    )
  })

  it('能力编辑中的模型被外部删除后保留草稿并要求显式确认关闭', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = modelFixture()
    const gateway = gatewayFixture({ providers: [provider], models: [model] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [provider] })
      .mockResolvedValue({ items: [] })
    vi.mocked(gateway.models)
      .mockResolvedValueOnce({ items: [model] })
      .mockResolvedValue({ items: [] })
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.catalog.edit')
    const displayName = screen.getByLabelText('settings.agent.modelEditor.displayName')

    fireEvent.change(displayName, { target: { value: 'Local model draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.modelDeleted')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.modelEditor.displayName')).toHaveValue('Local model draft')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    const description = await screen.findByText('settings.agent.modelEditor.discardDescription')
    const confirmDialog = description.closest<HTMLElement>('[role="dialog"]')
    expect(confirmDialog).not.toBeNull()
    expect(screen.getByLabelText('settings.agent.modelEditor.displayName')).toHaveValue('Local model draft')
    await user.click(within(confirmDialog!).getByRole('button', {
      name: 'settings.agent.providers.discard',
    }))

    await waitFor(() => expect(screen.queryByText('settings.agent.conflict.modelDeleted')).not.toBeInTheDocument())
  })

  it('编辑中的模型被外部逻辑移除后保留草稿并禁止保存', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = modelFixture()
    const removed = {
      ...modelFixture(2),
      removed_at: '2026-08-30T00:02:00Z',
    }
    const gateway = gatewayFixture({ providers: [provider], models: [model] })
    vi.mocked(gateway.models)
      .mockResolvedValueOnce({ items: [model] })
      .mockResolvedValue({ items: [removed] })
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.catalog.edit')

    fireEvent.change(screen.getByLabelText('settings.agent.modelEditor.displayName'), {
      target: { value: 'Local model draft' },
    })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.modelRemoved')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.modelEditor.displayName')).toHaveValue('Local model draft')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(await screen.findByText('settings.agent.modelEditor.discardDescription')).toBeInTheDocument()
  })

  it('模型移除 revision 冲突后关闭确认框并保留显式冲突入口', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const original = modelFixture(1)
    const refreshed = modelFixture(2)
    const gateway = gatewayFixture({ providers: [provider], models: [original] })
    vi.mocked(gateway.models)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValue({ items: [refreshed] })
    vi.mocked(gateway.removeModel).mockRejectedValue(
      new TermousApiError('revision conflict', 'AGENT_REVISION_CONFLICT', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.catalog.remove')
    const description = await screen.findByText('settings.agent.catalog.confirmRemoveDescription')
    const dialog = description.closest<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()

    await user.click(within(dialog!).getByRole('button', { name: 'settings.agent.catalog.remove' }))

    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'))
    expect(await screen.findByText('settings.agent.conflict.description')).toBeInTheDocument()
    expect(gateway.removeModel).toHaveBeenCalledTimes(1)
    expect(gateway.removeModel).toHaveBeenCalledWith(
      original.id, original.revision, expect.any(AbortSignal),
    )
  })

  it('新增模型期间 Provider 被外部删除时不把草稿切换到其他 Provider', async () => {
    const user = userEvent.setup()
    const original = providerFixture()
    const fallback = {
      ...providerFixture(),
      id: 'apv-2',
      name: 'Provider B',
      base_url: 'https://provider-b.example.test/v1',
    }
    const gateway = gatewayFixture({ providers: [original, fallback] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original, fallback] })
      .mockResolvedValue({ items: [fallback] })
    renderPanel(gateway)
    await screen.findByDisplayValue(original.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.add' }))

    fireEvent.change(screen.getByLabelText('settings.agent.modelEditor.modelId'), {
      target: { value: 'draft-model' },
    })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.providerDeleted')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.modelEditor.modelId')).toHaveValue('draft-model')
    expect(within(screen.getByRole('dialog')).getByText(original.name)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByText(fallback.name)).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' }))
      .toBeDisabled()
  })

  it('模型能力脏草稿遇到外部 revision 更新时显式换基线后才保存', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const original = modelFixture(1)
    const external = { ...modelFixture(2), display_name: 'Server model name' }
    const saved = { ...modelFixture(3), display_name: 'Local model draft' }
    const gateway = gatewayFixture({ providers: [provider], models: [original] })
    vi.mocked(gateway.modelProviders).mockResolvedValue({ items: [provider] })
    vi.mocked(gateway.models)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValueOnce({ items: [external] })
      .mockResolvedValue({ items: [saved] })
    vi.mocked(gateway.updateModel).mockResolvedValue(saved)
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.catalog.edit')
    const displayName = screen.getByLabelText('settings.agent.modelEditor.displayName')

    fireEvent.change(displayName, { target: { value: saved.display_name } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.editorDescription')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.modelEditor.displayName')).toHaveValue(saved.display_name)
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' }))
    expect(await screen.findByText('settings.agent.conflict.draftPreserved')).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(gateway.updateModel).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({
        display_name: saved.display_name,
        expected_revision: external.revision,
      }),
      expect.any(AbortSignal),
    ))
  })

  it('确认丢弃连接草稿后不保留隐藏页签中的本地值', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    renderPanel(gatewayFixture({ providers: [provider] }))
    const input = await screen.findByDisplayValue(provider.name)

    fireEvent.change(input, { target: { value: 'Discarded draft' } })
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await user.click(screen.getByRole('button', { name: 'settings.agent.providers.discard' }))
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.connectionTab' }))

    expect(screen.getByLabelText('settings.agent.providerEditor.name')).toHaveValue(provider.name)
  })

  it('Provider revision 冲突解决并保存成功后清除草稿保留提示', async () => {
    const user = userEvent.setup()
    const original = providerFixture()
    const refreshed = { ...providerFixture(2), name: 'Server Provider' }
    const saved = { ...providerFixture(3), name: 'Draft Provider' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValue({ items: [saved] })
    vi.mocked(gateway.updateModelProvider)
      .mockRejectedValueOnce(new TermousApiError('revision conflict', 'AGENT_REVISION_CONFLICT', 409))
      .mockResolvedValueOnce(saved)
    renderPanel(gateway)
    const input = await screen.findByDisplayValue(original.name)

    fireEvent.change(input, { target: { value: saved.name } })
    await user.click(screen.getByRole('button', { name: 'app.save' }))
    const conflictRefreshAction = await screen.findByRole('button', {
      name: 'settings.agent.conflict.refresh',
    })
    expect(screen.getAllByRole('button', { name: 'settings.agent.conflict.refresh' })).toHaveLength(1)
    await user.click(conflictRefreshAction)
    expect(await screen.findByText('settings.agent.conflict.draftPreserved')).toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'app.save' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => expect(screen.queryByText('settings.agent.conflict.draftPreserved')).not.toBeInTheDocument())
  })

  it('重置冲突草稿后新的编辑不再展示过期的草稿保留提示', async () => {
    const user = userEvent.setup()
    const original = providerFixture(1)
    const refreshed = { ...providerFixture(2), name: 'Server Provider' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.modelProviders)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValue({ items: [refreshed] })
    renderPanel(gateway)
    const input = await screen.findByDisplayValue(original.name)

    fireEvent.change(input, { target: { value: 'Draft Provider' } })
    await user.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))
    await user.click(await screen.findByRole('button', { name: 'settings.agent.conflict.refresh' }))
    expect(await screen.findByText('settings.agent.conflict.draftPreserved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.agent.providerEditor.reset' }))
    expect(screen.queryByText('settings.agent.conflict.draftPreserved')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('settings.agent.providerEditor.name'), {
      target: { value: 'Another draft' },
    })

    expect(screen.queryByText('settings.agent.conflict.draftPreserved')).not.toBeInTheDocument()
  })

  it('离开 Provider 冲突编辑器后恢复显示全局冲突入口', async () => {
    const user = userEvent.setup()
    const original = providerFixture()
    const gateway = gatewayFixture({ providers: [original], models: [modelFixture()] })
    vi.mocked(gateway.updateModelProvider).mockRejectedValue(
      new TermousApiError('revision conflict', 'AGENT_REVISION_CONFLICT', 409),
    )
    renderPanel(gateway)
    const input = await screen.findByDisplayValue(original.name)

    fireEvent.change(input, { target: { value: 'Draft Provider' } })
    await user.click(screen.getByRole('button', { name: 'app.save' }))
    expect(await screen.findByText('settings.agent.conflict.editorDescription')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await user.click(screen.getByRole('button', { name: 'settings.agent.providers.discard' }))

    expect(await screen.findByText('settings.agent.conflict.description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' })).toBeInTheDocument()
  })

  it('新建 Provider 只修改 API 模式时仍保护未保存草稿', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    renderPanel(gatewayFixture({ providers: [provider] }))
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('button', { name: 'settings.agent.providers.add' }))
    const apiModeField = screen.getByText('settings.agent.providerEditor.apiMode').closest('label')!
    const apiMode = within(apiModeField).getByRole('combobox')
    await user.click(apiMode)
    await user.click(await screen.findByText('settings.agent.apiMode.chatCompletions'))
    await user.click(screen.getByRole('button', { name: new RegExp(provider.name) }))

    expect(screen.getByText('settings.agent.providers.discardTitle')).toBeInTheDocument()
  })

  it('模型能力冲突使用稳定错误码展示可操作提示', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = modelFixture()
    const gateway = gatewayFixture({ providers: [provider], models: [model] })
    vi.mocked(gateway.updateModel).mockRejectedValue(
      new TermousApiError('capability conflict', 'AGENT_MODEL_CAPABILITY_CONFLICT', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.catalog.edit')
    fireEvent.change(screen.getByLabelText('settings.agent.modelEditor.displayName'), {
      target: { value: 'Changed model name' },
    })
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' }))

    expect(await screen.findByText('settings.agent.error.modelCapabilityConflict')).toBeInTheDocument()
  })

  it('手工新增模型冲突时在编辑弹窗内展示准确错误且不误报 revision 冲突', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const gateway = gatewayFixture({ providers: [provider] })
    vi.mocked(gateway.createModel).mockRejectedValue(
      new TermousApiError('model id conflict', 'AGENT_MODEL_ID_CONFLICT', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.add' }))
    await user.type(screen.getByLabelText('settings.agent.modelEditor.modelId'), 'duplicate-model')

    const editor = screen.getByRole('dialog')
    await user.click(within(editor).getByRole('button', { name: 'app.save' }))

    expect(await within(editor).findByText('settings.agent.error.modelIdConflict')).toBeInTheDocument()
    expect(screen.queryByText('settings.agent.error.conflict')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.agent.conflict.description')).not.toBeInTheDocument()
  })

  it('非 revision 的 HTTP 409 按稳定业务错误码展示', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const gateway = gatewayFixture({ providers: [provider] })
    vi.mocked(gateway.deleteModelProvider).mockRejectedValue(
      new TermousApiError('provider in use', 'AGENT_MODEL_PROVIDER_IN_USE', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('button', { name: 'app.delete' }))
    const dialog = (await screen.findByText('settings.agent.confirmDelete.description'))
      .closest<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    await user.click(within(dialog!).getByRole('button', { name: 'app.delete' }))

    expect(await screen.findByText('settings.agent.error.providerInUse')).toBeInTheDocument()
    expect(screen.queryByText('settings.agent.error.conflict')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.agent.conflict.description')).not.toBeInTheDocument()
  })

  it('目录刷新图标只在真实同步期间显示 loading', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const deletePending = deferred<void>()
    const refreshPending = deferred<AgentModelProvider>()
    const gateway = gatewayFixture({ providers: [provider] })
    vi.mocked(gateway.deleteModelProvider).mockReturnValue(deletePending.promise)
    vi.mocked(gateway.refreshProviderModels).mockReturnValue(refreshPending.promise)
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)
    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    const refresh = screen.getByRole('button', { name: 'settings.agent.catalog.refresh' })

    await user.click(screen.getByRole('button', { name: 'app.delete' }))
    const deleteDialog = (await screen.findByText('settings.agent.confirmDelete.description'))
      .closest<HTMLElement>('[role="dialog"]')
    await user.click(within(deleteDialog!).getByRole('button', { name: 'app.delete' }))
    expect(refresh).not.toHaveClass('ant-btn-loading')

    deletePending.reject(new TermousApiError('provider in use', 'AGENT_MODEL_PROVIDER_IN_USE', 409))
    await waitFor(() => expect(refresh).toBeEnabled())
    await user.click(refresh)
    await waitFor(() => expect(refresh).toHaveClass('ant-btn-loading'))

    refreshPending.resolve(providerFixture(2))
    await waitFor(() => expect(refresh).not.toHaveClass('ant-btn-loading'))
  })

  it('明文 HTTP Provider 在统一表单持续展示传输风险', async () => {
    const provider = { ...providerFixture(), base_url: 'http://127.0.0.1:11434/v1' }
    renderPanel(gatewayFixture({ providers: [provider] }))
    await screen.findByDisplayValue(provider.name)

    expect(screen.getByText('settings.agent.providerEditor.httpRiskTitle')).toBeInTheDocument()
    expect(screen.getByText('settings.agent.providerEditor.httpRisk')).toBeInTheDocument()
  })

  it('Provider 测试请求失败时就近通知并保留 revision 冲突入口', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const gateway = gatewayFixture({ providers: [provider] })
    vi.mocked(gateway.testModelProvider).mockRejectedValue(
      new TermousApiError('revision conflict', 'AGENT_REVISION_CONFLICT', 409),
    )
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('button', { name: 'settings.agent.providers.test' }))

    expect(await screen.findByText('settings.agent.providers.testFailed')).toBeInTheDocument()
    expect(screen.getByText('settings.agent.conflict.description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.agent.conflict.refresh' })).toBeInTheDocument()
  })

  it('模型测试请求失败时提供就近通知', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const gateway = gatewayFixture({ providers: [provider], models: [modelFixture()] })
    vi.mocked(gateway.testModel).mockRejectedValue(new Error('network unavailable'))
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))
    await chooseModelAction(user, 'settings.agent.models.test')
    await user.click(screen.getByRole('button', { name: 'settings.agent.confirmTest.confirm' }))

    expect(await screen.findByText('settings.agent.testFailed')).toBeInTheDocument()
  })

  it('模型目录按稳定错误码展示可执行的失败原因', async () => {
    const user = userEvent.setup()
    const provider = {
      ...providerFixture(2, true, 'failed'),
      last_refresh_error_code: 'authentication_failed',
    }
    renderPanel(gatewayFixture({ providers: [provider] }))
    await screen.findByDisplayValue(provider.name)

    await user.click(screen.getByRole('tab', { name: 'settings.agent.providers.catalogTab' }))

    expect(await screen.findByText('settings.agent.catalog.errorDescription.authentication_failed'))
      .toBeInTheDocument()
  })
})

async function chooseModelAction(
  user: ReturnType<typeof userEvent.setup>,
  action: string,
) {
  await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.moreActions' }))
  await user.click(await screen.findByRole('menuitem', { name: action }))
}

function renderPanel(gateway: AgentSetupGateway) {
  return render(<AntdApp><AgentSettingsPanel gateway={gateway} /></AntdApp>)
}

function gatewayFixture(options: {
  provider?: AgentModelProvider
  providers?: AgentModelProvider[]
  models?: AgentModel[]
  readiness?: AgentReadiness
} = {}): AgentSetupGateway {
  const providers = options.providers ?? (options.provider ? [options.provider] : [])
  const models = options.models ?? []
  const readiness = options.readiness ?? readinessFixture()
  return {
    settings: vi.fn(async () => readiness.settings),
    updateSettings: vi.fn(async (input) => {
      const settings: AgentSettings = {
        ...readiness.settings,
        default_reasoning_level: input.default_reasoning_level,
        global_context_window_tokens: input.global_context_window_tokens,
        global_max_output_tokens: input.global_max_output_tokens,
        show_turn_token_usage: input.show_turn_token_usage,
        revision: input.expected_revision + 1,
        updated_at: '2026-08-30T00:01:00Z',
      }
      if (input.default_model_id) settings.default_model_id = input.default_model_id
      else delete settings.default_model_id
      return settings
    }),
    readiness: vi.fn(async () => readiness),
    setup: vi.fn(async () => readiness),
    updateMcpPolicy: vi.fn(async (input) => ({ ...readiness.mcp_policy!, approval_bypass: input.approval_bypass, revision: 2 })),
    modelProviders: vi.fn(async () => ({ items: providers })),
    createModelProvider: vi.fn(async (input) => ({ ...providerFixture(), ...input })),
    updateModelProvider: vi.fn(async (_id, input) => ({ ...providerFixture(input.expected_revision + 1), ...input })),
    deleteModelProvider: vi.fn(async () => undefined),
    testModelProvider: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 10, model_count: models.length, message: '' })),
    refreshProviderModels: vi.fn(async () => providerFixture(2, false, 'ready')),
    models: vi.fn(async () => ({ items: models })),
    model: vi.fn(async () => models[0] ?? modelFixture()),
    createModel: vi.fn(async (_providerId, input) => ({
      model: { ...modelFixture(), ...input, source: 'manual' as const },
      provider_revision: input.expected_revision + 1,
    })),
    updateModel: vi.fn(async (_id, input) => ({ ...modelFixture(input.expected_revision + 1), ...input })),
    removeModel: vi.fn(async () => undefined),
    restoreModel: vi.fn(async () => modelFixture(2)),
    testModel: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 10, model_id: 'gpt-test', message: '' })),
  }
}

function readinessFixture(revision = 1, defaultModelId = ''): AgentReadiness {
  return {
    status: defaultModelId ? 'ready' : 'needs_setup',
    mcp_runtime: { status: 'ready', message: '后端消息' },
    mcp_client: { status: 'ready', message: '后端消息' },
    skills_bundle: { status: 'ready', message: '后端消息' },
    default_model: { status: defaultModelId ? 'ready' : 'missing', message: '后端消息' },
    mcp_policy: {
      client_id: 'client-1', approval_bypass: false, scope_count: 29,
      required_scope_count: 29, scope_sync_required: false, revision: 1,
    },
    settings: {
      ...(defaultModelId ? { default_model_id: defaultModelId } : {}),
      default_reasoning_level: 'off', show_turn_token_usage: true, revision,
      global_context_window_tokens: 16_384, global_max_output_tokens: 4_096,
      created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
    },
  }
}

function providerFixture(
  revision = 1,
  apiKeyConfigured = false,
  refreshStatus: AgentModelProvider['refresh_status'] = 'ready',
): AgentModelProvider {
  return {
    id: 'apv-1', name: 'Provider', api_mode: 'responses', base_url: 'https://example.test/v1',
    enabled: true, api_key_configured: apiKeyConfigured, refresh_status: refreshStatus, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function modelFixture(revision = 1): AgentModel {
  return {
    id: 'apm-1', provider_id: 'apv-1', remote_model_id: 'gpt-test', display_name: 'GPT Test',
    availability: 'available', source: 'sync', parameter_mode: 'custom',
    context_window_tokens: 8192, max_output_tokens: 1024, default_reasoning_level: 'off',
    reasoning_control: 'openai_effort', supported_reasoning_levels: ['off', 'minimal', 'low', 'medium', 'high'],
    supports_images: false, supports_reasoning: true, capabilities_confirmed: false,
    effective_context_window_tokens: 8192, effective_max_output_tokens: 1024,
    effective_default_reasoning_level: 'off',
    first_seen_at: '2026-08-28T00:00:00Z', last_seen_at: '2026-08-28T00:00:00Z', revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
