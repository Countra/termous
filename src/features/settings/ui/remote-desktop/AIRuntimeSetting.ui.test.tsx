import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AIRuntimeGatewayContext, type AIRuntimeGateway, type AIRuntimeStatus } from '#entities/ai-runtime'
import { AIRuntimeSetting } from './AIRuntimeSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const state: AIRuntimeStatus = { capabilities: { gpu_install: true, gpu_check: true }, managed: true, state: 'complete', profile: 'cpu', download_size: 2762774229,
  device: { name: 'NVIDIA', driver: 12080, eligible: true } }

describe('画面分析组件设置', () => {
  it('CPU 平台保持可用状态并隐藏不支持的 GPU 维护操作', async () => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state,
      capabilities: { gpu_install: false, gpu_check: false }, device: { name: '', driver: 0, eligible: false },
      service: { state: 'ready', device: 'cpu' } }), download: vi.fn(), cancel: vi.fn(), check: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await screen.findByText('settings.aiRuntime.cpu')
    expect(screen.getByText('settings.aiRuntime.cpuDescription')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.aiRuntime.download' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.aiRuntime.check' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.aiRuntime.requirements')).not.toBeInTheDocument()
  })

  it.each([
    { service: { state: 'ready', device: 'cuda' }, label: 'gpu' },
    { service: { state: 'busy', device: 'cpu' }, label: 'cpu' },
    { service: { state: 'not_started' }, label: 'unknown' },
    { service: { state: 'failed', device: 'cuda' }, label: 'unknown' },
  ])('开发环境按实际服务显示设备：$label / $service.state', async ({ service, label }) => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, managed: false,
      state: 'development', profile: '', service }), download: vi.fn(), cancel: vi.fn(), check: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await waitFor(() => expect(screen.getByText(`settings.aiRuntime.${label}`)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'settings.aiRuntime.download' })).toBeDisabled()
    if (label !== 'cpu') expect(screen.queryByText('settings.aiRuntime.cpu')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.aiRuntime.ready')).not.toBeInTheDocument()
  })

  it('历史 GPU 检查通过不能覆盖当前 CPU 服务的实际设备', async () => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, profile: 'cuda',
      check: { cpu_available: true, gpu_available: true, device: 'cuda' }, service: { state: 'ready', device: 'cpu' } }),
      download: vi.fn(), cancel: vi.fn(), check: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await screen.findByText('settings.aiRuntime.cpu')
    expect(screen.queryByText('settings.aiRuntime.gpu')).not.toBeInTheDocument()
  })

  it('下载由后端创建任务，写入阶段禁用取消', async () => {
    const installing = { id: 'one', phase: 'installing' as const, downloaded: 100, total: 100, cancellable: false }
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue(state),
      download: vi.fn(async () => { vi.mocked(gateway.status).mockResolvedValue({ ...state, task: installing }); return installing }),
      cancel: vi.fn(), check: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.aiRuntime.download' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'settings.aiRuntime.download' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled())
    expect(gateway.download).toHaveBeenCalledTimes(1)
    expect(gateway.cancel).not.toHaveBeenCalled()
  })
})
