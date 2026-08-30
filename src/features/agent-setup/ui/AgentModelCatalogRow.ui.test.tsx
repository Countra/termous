import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentModel, AgentModelProvider } from '#entities/agent'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { AgentModelCatalogRow } from './AgentModelCatalogRow.tsx'

describe('AgentModelCatalogRow', () => {
  it('活动模型通过更多菜单触发逻辑移除', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const model = modelFixture()
    renderRow(model, { onRemove })

    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.moreActions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'settings.agent.catalog.remove' }))

    expect(onRemove).toHaveBeenCalledWith(model)
  })

  it('已移除模型只提供恢复操作', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const model = { ...modelFixture(), removed_at: '2026-08-30T01:00:00Z' }
    renderRow(model, { onRestore })

    await user.click(screen.getByRole('button', { name: 'settings.agent.catalog.moreActions' }))
    expect(screen.queryByRole('menuitem', { name: 'settings.agent.catalog.remove' }))
      .not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'settings.agent.catalog.restore' }))

    expect(onRestore).toHaveBeenCalledWith(model)
  })

  it('悬浮详情承载 Provider、同步状态、最近发现时间和有效参数', async () => {
    const user = userEvent.setup()
    renderRow({ ...modelFixture(), source: 'sync' })

    await user.hover(screen.getByText('remote-model'))

    expect(await screen.findByText('settings.agent.catalog.detail.provider')).toBeInTheDocument()
    expect(screen.getByText('settings.agent.catalog.detail.synced')).toBeInTheDocument()
    expect(screen.getByText('settings.agent.catalog.detail.lastSeen')).toBeInTheDocument()
    expect(screen.getByText('settings.agent.catalog.detail.context')).toBeInTheDocument()
  })
})

function renderRow(model: AgentModel, overrides: {
  onRemove?: (model: AgentModel) => void
  onRestore?: (model: AgentModel) => void
} = {}) {
  return render(
    <AntdApp>
      <AgentModelCatalogRow
        provider={providerFixture()}
        model={model}
        disabled={false}
        onEdit={vi.fn()}
        onTest={vi.fn()}
        onSetDefault={vi.fn()}
        onRemove={overrides.onRemove ?? vi.fn()}
        onRestore={overrides.onRestore ?? vi.fn()}
      />
    </AntdApp>,
  )
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
    parameter_mode: 'inherit_global',
    context_window_tokens: 16_384,
    max_output_tokens: 4_096,
    default_reasoning_level: 'off',
    reasoning_control: 'none',
    supported_reasoning_levels: ['off'],
    supports_images: false,
    supports_reasoning: false,
    capabilities_confirmed: true,
    effective_context_window_tokens: 16_384,
    effective_max_output_tokens: 4_096,
    effective_default_reasoning_level: 'off',
    first_seen_at: '2026-08-30T00:00:00Z',
    last_seen_at: '2026-08-30T00:00:00Z',
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}
