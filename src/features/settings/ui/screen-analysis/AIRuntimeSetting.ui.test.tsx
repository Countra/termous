import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AIRuntimeGatewayContext, type AIRuntimeGateway, type AIRuntimeStatus, type AIRuntimeTask } from '#entities/ai-runtime'
import { AIRuntimeSetting } from './AIRuntimeSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const state: AIRuntimeStatus = { capabilities: { gpu_install: true, gpu_check: true }, managed: true, state: 'complete', profile: 'cpu', download_size: 2762774229,
  device: { name: 'NVIDIA', driver: 12080, eligible: true } }

describe('画面分析运行环境设置', () => {
  it('未激活时不读取，切换页面取消在途观察并忽略迟到响应', async () => {
    let resolve: (value: AIRuntimeStatus) => void = () => {}
    const gateway: AIRuntimeGateway = { status: vi.fn().mockImplementationOnce(() => new Promise<AIRuntimeStatus>(done => { resolve = done }))
      .mockResolvedValue({ ...state, service: { state: 'ready', device: 'cpu' } }),
      download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    const view = (active: boolean) => <AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} active={active} /></AIRuntimeGatewayContext>
    const { rerender } = render(view(false))
    expect(gateway.status).not.toHaveBeenCalled()
    rerender(view(true))
    expect(gateway.status).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(gateway.status).mock.calls[0][0]!
    rerender(view(false))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve({ ...state, service: { state: 'ready', device: 'cuda' } }))
    expect(screen.queryByText('settings.aiRuntime.gpu')).not.toBeInTheDocument()
    rerender(view(true))
    await screen.findByText('settings.aiRuntime.cpu')
    expect(gateway.status).toHaveBeenCalledTimes(2)
    expect(gateway.cancel).not.toHaveBeenCalled()
    expect(gateway.warmup).not.toHaveBeenCalled()
  })

  it('窗口隐藏时停止轮询，恢复可见后重新读取', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, service: { state: 'ready', device: 'cpu' } }),
      download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    try {
      const { unmount } = render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
      await act(async () => {})
      expect(gateway.status).toHaveBeenCalledTimes(1)
      visibility.mockReturnValue('hidden')
      fireEvent(document, new Event('visibilitychange'))
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(gateway.status).toHaveBeenCalledTimes(1)
      visibility.mockReturnValue('visible')
      fireEvent(document, new Event('visibilitychange'))
      await act(async () => {})
      expect(gateway.status).toHaveBeenCalledTimes(2)
      unmount()
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(gateway.status).toHaveBeenCalledTimes(2)
    } finally { visibility.mockRestore(); vi.useRealTimers() }
  })

  it('维护提交期间离开页面不会取消后台任务，返回后可以继续操作', async () => {
    let complete: (value: AIRuntimeTask) => void = () => {}
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue(state),
      download: vi.fn(() => new Promise<AIRuntimeTask>(done => { complete = done })),
      cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    const view = (active: boolean) => <AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} active={active} /></AIRuntimeGatewayContext>
    const { rerender } = render(view(true))
    const download = await screen.findByRole('button', { name: 'settings.aiRuntime.download' })
    await waitFor(() => expect(download).toBeEnabled())
    fireEvent.click(download)
    expect(gateway.download).toHaveBeenCalledTimes(1)
    rerender(view(false))
    await act(async () => complete({ id: 'one', phase: 'complete', downloaded: 100, total: 100, cancellable: false }))
    expect(gateway.status).toHaveBeenCalledTimes(1)
    expect(gateway.cancel).not.toHaveBeenCalled()
    rerender(view(true))
    await waitFor(() => expect(download).toBeEnabled())
    expect(gateway.status).toHaveBeenCalledTimes(2)
  })

  it('维护后的刷新取代旧轮询，迟到的旧状态不能覆盖新任务', async () => {
    vi.useFakeTimers()
    let complete: (value: AIRuntimeStatus) => void = () => {}
    const installing: AIRuntimeTask = { id: 'install', phase: 'installing', downloaded: 100, total: 100, cancellable: false }
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValueOnce(state)
      .mockImplementationOnce(() => new Promise<AIRuntimeStatus>(done => { complete = done }))
      .mockResolvedValue({ ...state, task: installing }),
      download: vi.fn().mockResolvedValue(installing), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    const { unmount } = render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    try {
      await act(async () => {})
      await act(() => vi.advanceTimersByTimeAsync(1500))
      const signal = vi.mocked(gateway.status).mock.calls[1][0]!
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.aiRuntime.download' })))
      expect(gateway.status).toHaveBeenCalledTimes(3)
      expect(signal.aborted).toBe(true)
      await act(async () => complete(state))
      expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
      expect(screen.getByText('settings.aiRuntime.phases.installing')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(1500))
      expect(gateway.status).toHaveBeenCalledTimes(4)
    } finally { unmount(); vi.useRealTimers() }
  })

  it('隐藏窗口取消维护后的状态读取，恢复时重新观察且不取消维护任务', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let complete: (value: AIRuntimeStatus) => void = () => {}
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValueOnce(state)
      .mockImplementationOnce(() => new Promise<AIRuntimeStatus>(done => { complete = done }))
      .mockResolvedValue(state), download: vi.fn().mockResolvedValue({ id: 'install' }),
      cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    const { unmount } = render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    try {
      await act(async () => {})
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.aiRuntime.download' })))
      const signal = vi.mocked(gateway.status).mock.calls[1][0]!
      visibility.mockReturnValue('hidden')
      fireEvent(document, new Event('visibilitychange'))
      expect(signal.aborted).toBe(true)
      await act(async () => complete({ ...state, service: { state: 'ready', device: 'cuda' } }))
      expect(screen.queryByText('settings.aiRuntime.gpu')).not.toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(gateway.status).toHaveBeenCalledTimes(2)
      expect(gateway.cancel).not.toHaveBeenCalled()
      visibility.mockReturnValue('visible')
      fireEvent(document, new Event('visibilitychange'))
      await act(async () => {})
      expect(gateway.status).toHaveBeenCalledTimes(3)
      expect(screen.getByRole('button', { name: 'settings.aiRuntime.download' })).toBeEnabled()
    } finally { unmount(); visibility.mockRestore(); vi.useRealTimers() }
  })

  it('CPU 平台保持可用状态并隐藏不支持的 GPU 维护操作', async () => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state,
      capabilities: { gpu_install: false, gpu_check: false }, device: { name: '', driver: 0, eligible: false },
      service: { state: 'ready', device: 'cpu' } }), download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await screen.findByText('settings.aiRuntime.cpu')
    expect(screen.getByText('settings.aiRuntime.cpuDescription')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.aiRuntime.download' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.aiRuntime.check' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.aiRuntime.requirements')).not.toBeInTheDocument()
  })

  it.each([
    { service: { state: 'idle', device: 'cuda' }, label: 'gpu' },
    { service: { state: 'loading', device: 'cpu' }, label: 'cpu' },
    { service: { state: 'warming', device: 'cuda' }, label: 'gpu' },
    { service: { state: 'ready', device: 'cuda' }, label: 'gpu' },
    { service: { state: 'busy', device: 'cpu' }, label: 'cpu' },
    { service: { state: 'not_started' }, label: 'unknown' },
    { service: { state: 'failed', device: 'cuda' }, label: 'unknown' },
  ])('开发环境按实际服务显示设备：$label / $service.state', async ({ service, label }) => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, managed: false,
      state: 'development', profile: '', service }), download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await waitFor(() => expect(screen.getByText(`settings.aiRuntime.${label}`)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'settings.aiRuntime.download' })).toBeDisabled()
    if (label !== 'cpu') expect(screen.queryByText('settings.aiRuntime.cpu')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.aiRuntime.ready')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.aiRuntime.cpuDescription')).not.toBeInTheDocument()
    expect(gateway.warmup).not.toHaveBeenCalled()
  })

  it('历史 GPU 检查通过不能覆盖当前 CPU 服务的实际设备', async () => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, profile: 'cuda',
      check: { cpu_available: true, gpu_available: true, device: 'cuda' }, service: { state: 'ready', device: 'cpu' } }),
      download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await screen.findByText('settings.aiRuntime.cpu')
    expect(screen.queryByText('settings.aiRuntime.gpu')).not.toBeInTheDocument()
    expect(screen.queryByText(state.device.name)).not.toBeInTheDocument()
  })

  it.each([
    { service: { state: 'ready', device: 'cuda' }, name: state.device.name },
    { service: { state: 'ready', device: 'cpu', device_name: 'CPU fixture' }, name: 'CPU fixture' },
  ])('按实际推理设备显示名称：$name', async ({ service, name }) => {
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue({ ...state, service }),
      download: vi.fn(), cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    expect(await screen.findByText(name)).toBeInTheDocument()
  })

  it('下载由后端创建任务，写入阶段禁用取消', async () => {
    const installing = { id: 'one', phase: 'installing' as const, downloaded: 100, total: 100, cancellable: false }
    const gateway: AIRuntimeGateway = { status: vi.fn().mockResolvedValue(state),
      download: vi.fn(async () => { vi.mocked(gateway.status).mockResolvedValue({ ...state, task: installing }); return installing }),
      cancel: vi.fn(), check: vi.fn(), warmup: vi.fn(), serviceStatus: vi.fn() }
    render(<AIRuntimeGatewayContext value={gateway}><AIRuntimeSetting disabled={false} /></AIRuntimeGatewayContext>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.aiRuntime.download' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'settings.aiRuntime.download' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled())
    expect(gateway.download).toHaveBeenCalledTimes(1)
    expect(gateway.cancel).not.toHaveBeenCalled()
  })
})
