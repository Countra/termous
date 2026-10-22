import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { AnalysisRuntimeStatus } from './AnalysisRuntimeStatus'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function media(runtimeStatus: NonNullable<WorkflowMediaGateway['runtimeStatus']>): WorkflowMediaGateway {
  return { runtimeStatus, openRuntimeSettings: vi.fn(), openPreview: vi.fn(), closePreview: vi.fn(),
    capture: vi.fn(), match: vi.fn(), upload: vi.fn(), asset: vi.fn(), analyze: vi.fn(),
    analysisImage: vi.fn(), deleteAnalysis: vi.fn() }
}

it('未取得状态时不显示 CPU，取得 CUDA 服务后显示 GPU', async () => {
  let resolve!: (value: Awaited<ReturnType<NonNullable<WorkflowMediaGateway['runtimeStatus']>>>) => void
  const gateway = media(() => new Promise(done => { resolve = done }))
  render(<AnalysisRuntimeStatus gateway={gateway} onError={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'settings.aiRuntime.unknown' })).toBeInTheDocument()
  await act(async () => resolve({ service: { state: 'ready', device: 'cuda' } }))
  expect(screen.getByRole('button', { name: 'settings.aiRuntime.gpu' })).toBeInTheDocument()
  expect(screen.queryByText('settings.aiRuntime.cpu')).not.toBeInTheDocument()
})

it.each([
  { service: { state: 'busy', device: 'cpu' }, label: 'cpu' },
  { service: { state: 'failed', device: 'cuda' }, label: 'unknown' },
  { service: undefined, label: 'unknown' },
])('工具栏仅使用已确认设备：$label', async ({ service, label }) => {
  render(<AnalysisRuntimeStatus gateway={media(async () => ({ service }))} onError={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: `settings.aiRuntime.${label}` })).toBeInTheDocument())
})
