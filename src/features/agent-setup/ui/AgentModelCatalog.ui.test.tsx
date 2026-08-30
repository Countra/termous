import { App as AntdApp } from 'antd'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentModel, AgentModelProvider } from '#entities/agent'
import styles from './AgentModelCatalog.module.scss'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./AgentModelCatalogRow.tsx', () => ({
  AgentModelCatalogRow: ({ model }: { model: AgentModel }) => (
    <article data-testid="agent-model-catalog-row">{model.remote_model_id}</article>
  ),
}))

import { AgentModelCatalog } from './AgentModelCatalog.tsx'

describe('AgentModelCatalog', () => {
  it('千条目录保持固定工具栏并只把模型列表作为滚动区域', () => {
    const models = Array.from({ length: 1000 }, (_, index) => modelFixture(index))
    render(
      <AntdApp>
        <AgentModelCatalog
          provider={providerFixture()}
          models={models}
          disabled={false}
          refreshing={false}
          onRefresh={vi.fn()}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onTest={vi.fn()}
          onSetDefault={vi.fn()}
          onRemove={vi.fn()}
          onRestore={vi.fn()}
        />
      </AntdApp>,
    )

    const toolbar = screen.getByTestId('agent-model-catalog-toolbar')
    const list = screen.getByTestId('agent-model-catalog-list')
    expect(toolbar).toHaveClass(styles['catalog-toolbar'])
    expect(list).toHaveClass(styles['catalog-list'])
    expect(toolbar.parentElement).toBe(list.parentElement)
    expect(list).not.toContainElement(toolbar)
    expect(within(list).getAllByTestId('agent-model-catalog-row')).toHaveLength(1000)
    expect(within(list).getByText('model-999')).toBeInTheDocument()
  })

  it('状态与来源筛选不会混入已移除或远程同步模型', async () => {
    const user = userEvent.setup()
    const activeSync = modelFixture(1)
    const activeManual = { ...modelFixture(2), source: 'manual' as const }
    const removedManual = {
      ...modelFixture(3),
      source: 'manual' as const,
      removed_at: '2026-08-30T01:00:00Z',
    }
    render(
      <AntdApp>
        <AgentModelCatalog
          provider={providerFixture()}
          models={[activeSync, activeManual, removedManual]}
          disabled={false}
          refreshing={false}
          onRefresh={vi.fn()}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onTest={vi.fn()}
          onSetDefault={vi.fn()}
          onRemove={vi.fn()}
          onRestore={vi.fn()}
        />
      </AntdApp>,
    )

    const list = screen.getByTestId('agent-model-catalog-list')
    expect(within(list).getByText(activeSync.remote_model_id)).toBeInTheDocument()
    expect(within(list).getByText(activeManual.remote_model_id)).toBeInTheDocument()
    expect(within(list).queryByText(removedManual.remote_model_id)).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'settings.agent.catalog.stateFilter' }))
    await user.click(await screen.findByText('settings.agent.catalog.filterState.all'))
    await user.click(screen.getByRole('combobox', { name: 'settings.agent.catalog.sourceFilter' }))
    await user.click(await screen.findByText('settings.agent.catalog.filterSource.manual'))

    expect(within(list).queryByText(activeSync.remote_model_id)).not.toBeInTheDocument()
    expect(within(list).getByText(activeManual.remote_model_id)).toBeInTheDocument()
    expect(within(list).getByText(removedManual.remote_model_id)).toBeInTheDocument()
  })
})

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

function modelFixture(index: number): AgentModel {
  return {
    id: `model-${index}`,
    provider_id: 'provider',
    remote_model_id: `model-${index}`,
    display_name: `Model ${index}`,
    availability: 'available',
    source: 'sync',
    parameter_mode: 'inherit_global',
    context_window_tokens: 16_384,
    max_output_tokens: 4_096,
    default_reasoning_level: 'off',
    reasoning_control: 'none',
    supported_reasoning_levels: ['off'],
    supports_images: false,
    supports_reasoning: false,
    capabilities_confirmed: false,
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
