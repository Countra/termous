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
  { service: { state: 'idle', device: 'cuda' }, label: 'gpu' },
  { service: { state: 'loading', device: 'cpu' }, label: 'cpu' },
  { service: { state: 'warming', device: 'cuda' }, label: 'gpu' },
  { service: { state: 'busy', device: 'cpu' }, label: 'cpu' },
  { service: { state: 'failed', device: 'cuda' }, label: 'unknown' },
  { service: undefined, label: 'unknown' },
])('工具栏仅使用已确认设备：$label', async ({ service, label }) => {
  render(<AnalysisRuntimeStatus gateway={media(async () => ({ service }))} onError={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: `settings.aiRuntime.${label}` })).toBeInTheDocument())
})

it('编辑器启用后每个实例预热一次，断线重启后预热新实例', async () => {
  vi.useFakeTimers()
  let service = { state: 'idle', device: 'cpu', instance_id: 'first' }
  const gateway = media(async () => ({ service }))
  gateway.warmupRuntime = vi.fn().mockResolvedValue(undefined)
  const view = render(<AnalysisRuntimeStatus gateway={gateway} active={false} onError={vi.fn()} />)
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(gateway.warmupRuntime).not.toHaveBeenCalled()
    view.rerender(<AnalysisRuntimeStatus gateway={gateway} active onError={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(1)
    service = { state: 'disconnected', device: '', instance_id: '' }
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByRole('button', { name: 'settings.aiRuntime.unknown' })).toBeInTheDocument()
    service = { state: 'idle', device: 'cuda', instance_id: 'second' }
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'settings.aiRuntime.gpu' })).toBeInTheDocument()
  } finally { view.unmount(); vi.useRealTimers() }
})

it('预热请求失败保留提示，不在同一实例上循环重试', async () => {
  vi.useFakeTimers()
  const gateway = media(async () => ({ service: { state: 'idle', device: 'cpu', instance_id: 'fixture' } }))
  gateway.warmupRuntime = vi.fn().mockRejectedValue(new Error('offline'))
  const view = render(<AnalysisRuntimeStatus gateway={gateway} active onError={vi.fn()} />)
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveTextContent('settings.aiRuntime.serviceShortStates.failed')
    expect(screen.getByRole('button')).toHaveAttribute('title', 'settings.aiRuntime.preparationFailed')
    view.rerender(<AnalysisRuntimeStatus gateway={gateway} active={false} onError={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    view.rerender(<AnalysisRuntimeStatus gateway={gateway} active onError={vi.fn()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveAttribute('title', 'settings.aiRuntime.preparationFailed')
  } finally { view.unmount(); vi.useRealTimers() }
})

it('切换预览后仍显示在途预热请求的失败结果', async () => {
  vi.useFakeTimers()
  let reject!: (reason: Error) => void
  const gateway = media(async () => ({ service: { state: 'idle', device: 'cpu', instance_id: 'fixture' } }))
  gateway.warmupRuntime = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  const view = render(<AnalysisRuntimeStatus gateway={gateway} active onError={vi.fn()} />)
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(1)
    view.rerender(<AnalysisRuntimeStatus gateway={gateway} active={false} onError={vi.fn()} />)
    await act(async () => { reject(new Error('offline')); await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByRole('button')).toHaveAttribute('title', 'settings.aiRuntime.preparationFailed')
    expect(gateway.warmupRuntime).toHaveBeenCalledTimes(1)
  } finally { view.unmount(); vi.useRealTimers() }
})
