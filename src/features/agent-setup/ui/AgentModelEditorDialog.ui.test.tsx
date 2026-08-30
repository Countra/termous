import type { ComponentProps } from 'react'
import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  agentReasoningLevels,
  type AgentModel,
  type AgentModelProvider,
  type AgentSettings,
} from '#entities/agent'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { AgentModelEditorDialog } from './AgentModelEditorDialog.tsx'

describe('AgentModelEditorDialog', () => {
  it('新增模型默认跟随全局参数并以模型 ID 回落显示名称', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => undefined)
    renderEditor({ onSave })

    await user.type(screen.getByLabelText('settings.agent.modelEditor.modelId'), 'manual-model')
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    expect(onSave).toHaveBeenCalledWith({
      remote_model_id: 'manual-model',
      display_name: 'manual-model',
      parameter_mode: 'inherit_global',
      context_window_tokens: 16_384,
      max_output_tokens: 4_096,
      default_reasoning_level: 'max',
      supports_images: true,
      reasoning_control: 'openai_effort',
      supported_reasoning_levels: agentReasoningLevels,
      capabilities_confirmed: true,
    }, undefined)
  })

  it('新增模型默认选择全部推理档位', () => {
    renderEditor()

    for (const level of agentReasoningLevels) {
      expect(screen.getByRole('checkbox', {
        name: `settings.agent.reasoning.${level}`,
      })).toBeChecked()
    }
    expect(screen.getByRole('button', {
      name: 'settings.agent.modelEditor.selectAllReasoningLevels',
    })).toBeDisabled()
  })

  it('全选操作恢复规范顺序并在重新启用推理时默认全选', async () => {
    const user = userEvent.setup()
    renderEditor({ model: modelFixture() })

    const selectAll = screen.getByRole('button', {
      name: 'settings.agent.modelEditor.selectAllReasoningLevels',
    })
    expect(selectAll).toBeEnabled()
    await user.click(selectAll)
    for (const level of agentReasoningLevels) {
      expect(screen.getByRole('checkbox', {
        name: `settings.agent.reasoning.${level}`,
      })).toBeChecked()
    }

    await user.click(screen.getByText('settings.agent.modelEditor.reasoningNone'))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByText('settings.agent.modelEditor.reasoningEffort'))
    for (const level of agentReasoningLevels) {
      expect(screen.getByRole('checkbox', {
        name: `settings.agent.reasoning.${level}`,
      })).toBeChecked()
    }
  })

  it('切换为跟随全局时展示后端规则解析后的有效推理档位', async () => {
    const user = userEvent.setup()
    renderEditor({ model: modelFixture() })

    await user.click(screen.getByText('settings.agent.modelEditor.inheritGlobal'))

    const effectiveReasoning = screen.getByText('settings.agent.modelEditor.defaultReasoning')
      .parentElement
    expect(effectiveReasoning).toHaveTextContent('settings.agent.reasoning.high')
  })

  it('推理能力档位允许移除 off 并保存明确的支持集合', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => undefined)
    renderEditor({ model: modelFixture(), onSave })

    const off = screen.getByRole('checkbox', { name: 'settings.agent.reasoning.off' })
    expect(off).toBeEnabled()
    await user.click(off)
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      reasoning_control: 'openai_effort',
      supported_reasoning_levels: ['low', 'high'],
    }), expect.objectContaining({ id: 'model' }))
  })

  it('移除当前默认档位时回落到不高于原值的最高支持档位', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => undefined)
    renderEditor({
      model: {
        ...modelFixture(),
        supported_reasoning_levels: ['off', 'low', 'medium', 'high'],
      },
      onSave,
    })

    await user.click(screen.getByRole('checkbox', { name: 'settings.agent.reasoning.high' }))
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      default_reasoning_level: 'medium',
      supported_reasoning_levels: ['off', 'low', 'medium'],
    }), expect.objectContaining({ id: 'model' }))
  })
})

function renderEditor({
  model,
  onSave = vi.fn(async () => undefined),
}: {
  model?: AgentModel
  onSave?: ComponentProps<typeof AgentModelEditorDialog>['onSave']
} = {}) {
  return render(
    <AntdApp>
      <AgentModelEditorDialog
        open
        provider={providerFixture()}
        model={model}
        settings={settingsFixture()}
        busy={false}
        conflicted={false}
        modelMissing={false}
        providerMissing={false}
        onCancel={vi.fn()}
        onResolveConflict={vi.fn(async () => model)}
        onSave={onSave}
      />
    </AntdApp>,
  )
}

function settingsFixture(): AgentSettings {
  return {
    default_reasoning_level: 'max',
    global_context_window_tokens: 16_384,
    global_max_output_tokens: 4_096,
    show_turn_token_usage: true,
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}

function providerFixture(): AgentModelProvider {
  return {
    id: 'provider',
    name: 'Provider',
    api_mode: 'responses',
    base_url: 'https://example.test/v1',
    enabled: true,
    api_key_configured: false,
    refresh_status: 'ready',
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}

function modelFixture(): AgentModel {
  return {
    id: 'model',
    provider_id: 'provider',
    remote_model_id: 'remote-model',
    display_name: 'Remote model',
    availability: 'available',
    source: 'manual',
    parameter_mode: 'custom',
    context_window_tokens: 65_536,
    max_output_tokens: 8_192,
    default_reasoning_level: 'high',
    reasoning_control: 'openai_effort',
    supported_reasoning_levels: ['off', 'low', 'high'],
    supports_images: false,
    supports_reasoning: true,
    capabilities_confirmed: true,
    effective_context_window_tokens: 65_536,
    effective_max_output_tokens: 8_192,
    effective_default_reasoning_level: 'high',
    first_seen_at: '2026-08-30T00:00:00Z',
    last_seen_at: '2026-08-30T00:00:00Z',
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}
