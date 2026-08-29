import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModel, AgentModelProvider, AgentReadiness } from '#entities/agent'
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

    await user.click(screen.getAllByRole('switch')[0]!)
    expect(screen.getByText('settings.agent.confirmBypass.description')).toBeInTheDocument()
    expect(gateway.updateMcpPolicy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.agent.confirmBypass.confirm' }))
    await waitFor(() => expect(gateway.updateMcpPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ approval_bypass: true }), expect.any(AbortSignal),
    ))
  })

  it('不支持 reasoning 的默认模型禁用高等级选项', async () => {
    const user = userEvent.setup()
    const provider = providerFixture()
    const model = { ...modelFixture(), supports_reasoning: false }
    const gateway = gatewayFixture({
      providers: [provider], models: [model], readiness: readinessFixture(1, model.id),
    })
    renderPanel(gateway)
    await screen.findByDisplayValue(provider.name)

    const defaultModelField = screen.getByText('settings.agent.defaults.model').closest('label')
    expect(defaultModelField).toHaveTextContent(model.display_name)
    expect(defaultModelField).not.toHaveTextContent(provider.name)
    const reasoningField = screen.getByText('settings.agent.defaults.reasoning').closest('label')!
    const reasoning = within(reasoningField).getByRole('combobox')
    await user.click(reasoning)
    const high = await screen.findByText('settings.agent.reasoning.high')
    expect(high.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled')
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
    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.editCapabilities' }))
    const displayName = screen.getByLabelText('settings.agent.modelEditor.displayName')

    fireEvent.change(displayName, { target: { value: 'Local model draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.agent.readiness.setup' }))

    expect(await screen.findByText('settings.agent.conflict.modelDeleted')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.agent.modelEditor.displayName')).toHaveValue('Local model draft')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()

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
    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.editCapabilities' }))
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
    await user.click(await screen.findByRole('button', {
      name: 'settings.agent.catalog.editCapabilities',
    }))
    const reasoningField = screen.getByText('settings.agent.modelEditor.reasoning').closest('label')!
    await user.click(within(reasoningField).getByRole('switch'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.save' }))

    expect(await screen.findByText('settings.agent.error.modelCapabilityConflict')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'settings.agent.models.test' }))
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
    updateSettings: vi.fn(async () => readiness.settings),
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
    updateModel: vi.fn(async (_id, input) => ({ ...modelFixture(input.expected_revision + 1), ...input })),
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
      default_reasoning_level: 'off', revision,
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
    availability: 'available', context_window_tokens: 8192, max_output_tokens: 1024,
    supports_images: false, supports_reasoning: true, capabilities_confirmed: false, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}
