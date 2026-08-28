import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModelProfile, AgentReadiness } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { AgentSettingsPanel } from './AgentSettingsPanel.tsx'
import { AgentApiKeyDialog } from './AgentApiKeyDialog.tsx'

describe('AgentSettingsPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('HTTP、模型测试与无需确认策略都必须先二次确认', async () => {
    const user = userEvent.setup()
    const gateway = gatewayFixture()
    renderPanel(gateway)
    await screen.findByRole('button', { name: 'app.edit' })

    await user.click(screen.getByRole('button', { name: 'app.edit' }))
    fireEvent.change(screen.getByLabelText('settings.agent.modelEditor.baseUrl'), {
      target: { value: 'http://127.0.0.1:11434/v1' },
    })
    await user.click(screen.getByRole('button', { name: 'app.save' }))
    expect(screen.getByText('settings.agent.confirmHttp.title')).toBeInTheDocument()
    expect(gateway.updateModelProfile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.agent.confirmHttp.confirm' }))
    await waitFor(() => expect(gateway.updateModelProfile).toHaveBeenCalledWith(
      'amp-1', expect.objectContaining({ confirm_insecure_http: true }), expect.any(AbortSignal),
    ))

    await user.click(screen.getByRole('button', { name: 'settings.agent.models.test' }))
    expect(screen.getByText('settings.agent.confirmTest.description')).toBeInTheDocument()
    expect(gateway.testModelProfile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'settings.agent.confirmTest.confirm' }))
    await waitFor(() => expect(gateway.testModelProfile).toHaveBeenCalledTimes(1))

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
    const profile = { ...profileFixture(), supports_reasoning: false }
    const gateway = gatewayFixture(profile, readinessFixture(1, profile.id))
    renderPanel(gateway)
    await screen.findByRole('button', { name: 'app.edit' })

    const reasoning = screen.getAllByRole('combobox')[1]!
    await user.click(reasoning)
    const high = await screen.findByText('settings.agent.reasoning.high')
    expect(high.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled')
  })

  it('API Key 使用 UTF-8 字节上限并在关闭后移除输入值', async () => {
    const user = userEvent.setup()
    const gateway = gatewayFixture()
    renderPanel(gateway)
    await screen.findByRole('button', { name: 'app.edit' })
    await user.click(screen.getByRole('button', { name: 'settings.agent.apiKey.title' }))

    const input = screen.getByLabelText('settings.agent.apiKey.fieldLabel')
    fireEvent.change(input, { target: { value: '密'.repeat(5462) } })
    expect(screen.getByText('settings.agent.apiKey.tooLarge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()

    fireEvent.change(input, { target: { value: 'a'.repeat(16 * 1024) } })
    expect(screen.queryByText('settings.agent.apiKey.tooLarge')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()

    fireEvent.change(input, { target: { value: 'one-time-secret' } })
    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    await waitFor(() => expect(screen.getByLabelText('settings.agent.apiKey.fieldLabel')).toHaveValue(''))
    expect(document.body.textContent).not.toContain('one-time-secret')
  })

  it('API Key 回车提交遵守字节上限与冲突边界', async () => {
    const onSave = vi.fn(async () => undefined)
    const props = {
      profile: profileFixture(),
      busy: false,
      conflicted: false,
      revisionRefreshed: false,
      onCancel: vi.fn(),
      onResolveConflict: vi.fn(async () => undefined),
      onSave,
    }
    const view = render(<AntdApp><AgentApiKeyDialog {...props} /></AntdApp>)
    const input = screen.getByLabelText('settings.agent.apiKey.fieldLabel')

    fireEvent.change(input, { target: { value: '密'.repeat(5462) } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'one-time-secret' } })
    view.rerender(<AntdApp><AgentApiKeyDialog {...props} conflicted /></AntdApp>)
    fireEvent.keyDown(screen.getByLabelText('settings.agent.apiKey.fieldLabel'), { key: 'Enter', code: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('409 rebase 保留模型草稿并使用最新 revision 再次保存', async () => {
    const user = userEvent.setup()
    const original = profileFixture(1)
    const refreshed = { ...original, revision: 2, name: 'Server name' }
    const saved = { ...refreshed, revision: 3, name: 'Local draft' }
    const gateway = gatewayFixture(original)
    vi.mocked(gateway.modelProfiles)
      .mockReset()
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValue({ items: [saved] })
    vi.mocked(gateway.updateModelProfile)
      .mockRejectedValueOnce(new TermousApiError('conflict', 'AGENT_REVISION_CONFLICT', 409))
      .mockResolvedValueOnce(saved)
    renderPanel(gateway)
    await screen.findByRole('button', { name: 'app.edit' })

    await user.click(screen.getByRole('button', { name: 'app.edit' }))
    const name = screen.getByLabelText('settings.agent.modelEditor.name')
    fireEvent.change(name, { target: { value: 'Local draft' } })
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    const dialog = await screen.findByRole('dialog')
    expect(name).toHaveValue('Local draft')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /app\.save/u })).toBeDisabled())
    await user.click(within(dialog).getByRole('button', { name: 'settings.agent.conflict.refresh' }))
    await screen.findByText('settings.agent.conflict.draftPreserved')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /app\.save/u })).toBeEnabled())
    expect(name).toHaveValue('Local draft')

    await user.click(within(dialog).getByRole('button', { name: /app\.save/u }))
    await waitFor(() => expect(gateway.updateModelProfile).toHaveBeenCalledTimes(2))
    expect(vi.mocked(gateway.updateModelProfile).mock.calls[1]).toEqual([
      'amp-1', expect.objectContaining({ name: 'Local draft', expected_revision: 2 }), expect.any(AbortSignal),
    ])
  })
})

function renderPanel(gateway: AgentSetupGateway) {
  return render(<AntdApp><AgentSettingsPanel gateway={gateway} /></AntdApp>)
}

function gatewayFixture(
  profile: AgentModelProfile = profileFixture(),
  readiness: AgentReadiness = readinessFixture(1, profile.id),
): AgentSetupGateway {
  return {
    settings: vi.fn(async () => readiness.settings),
    updateSettings: vi.fn(async () => readiness.settings),
    readiness: vi.fn(async () => readiness),
    setup: vi.fn(async () => readiness),
    updateMcpPolicy: vi.fn(async (input) => ({ ...readiness.mcp_policy!, approval_bypass: input.approval_bypass, revision: 2 })),
    modelProfiles: vi.fn(async () => ({ items: [profile] })),
    createModelProfile: vi.fn(async (input) => ({ ...profile, ...input })),
    updateModelProfile: vi.fn(async (_id, input) => ({ ...profile, ...input, revision: input.expected_revision + 1 })),
    deleteModelProfile: vi.fn(async () => undefined),
    testModelProfile: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 10, model_id: profile.model_id, message: '后端消息' })),
    replaceModelApiKey: vi.fn(async () => ({ ...profile, api_key_configured: true, revision: profile.revision + 1 })),
    deleteModelApiKey: vi.fn(async () => ({ ...profile, api_key_configured: false, revision: profile.revision + 1 })),
  }
}

function readinessFixture(revision = 1, defaultModelProfileId = 'amp-1'): AgentReadiness {
  return {
    status: 'ready',
    mcp_runtime: { status: 'ready', message: '后端消息' },
    mcp_client: { status: 'ready', message: '后端消息' },
    skills_bundle: { status: 'ready', message: '后端消息' },
    default_model: { status: 'ready', message: '后端消息' },
    mcp_policy: {
      client_id: 'client-1', approval_bypass: false, scope_count: 29,
      required_scope_count: 29, scope_sync_required: false, revision: 1,
    },
    settings: {
      default_model_profile_id: defaultModelProfileId,
      default_reasoning_level: 'off', revision,
      created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
    },
  }
}

function profileFixture(revision = 1): AgentModelProfile {
  return {
    id: 'amp-1', name: 'Model', api_mode: 'responses', base_url: 'https://example.test/v1', model_id: 'gpt-test',
    context_window_tokens: 8192, max_output_tokens: 1024, supports_images: false, supports_reasoning: true,
    api_key_configured: false, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}
