import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AIRuntimeGateway } from '#entities/ai-runtime'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowWorkspace } from './WorkflowWorkspace'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

class SocketFixture { close() {} }
beforeEach(() => { vi.stubGlobal('WebSocket', SocketFixture) })
afterEach(() => { vi.unstubAllGlobals() })

function fixture() {
  const gateway: WorkflowGateway = {
    list: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), get: vi.fn(), save: vi.fn(),
    remove: vi.fn(), versions: vi.fn(), restore: vi.fn(), validate: vi.fn(), upload: vi.fn(), asset: vi.fn(),
    openPreview: vi.fn(), closePreview: vi.fn(), capture: vi.fn(), match: vi.fn(), validateAnalysisAction: vi.fn(), analysisFull: vi.fn(), renderAnalysisImage: vi.fn(), submitAnalysis: vi.fn(), getAnalysis: vi.fn(), listAnalyses: vi.fn(), cancelAnalysis: vi.fn(), clearAnalyses: vi.fn(), analysisElements: vi.fn(), analysisElement: vi.fn(), analysisSpans: vi.fn(), analysisSpan: vi.fn(), analysisGeometry: vi.fn(), analysisDiagnostics: vi.fn(), exportAnalysis: vi.fn(), analysisStorage: vi.fn(),
    analysisImage: vi.fn(), deleteAnalysis: vi.fn(), run: vi.fn(), start: vi.fn(), control: vi.fn(), eventsURL: () => 'ws://127.0.0.1/events',
  }
  const runtime: AIRuntimeGateway = {
    serviceStatus: vi.fn().mockResolvedValue({ state: 'idle', device: 'cpu', instance_id: 'first' }),
    warmup: vi.fn().mockResolvedValue(undefined), status: vi.fn(), download: vi.fn(), cancel: vi.fn(), check: vi.fn(),
  }
  return { gateway, runtime, props: { gateway, aiRuntimeGateway: runtime, sessions: [], profiles: [],
    onDirtyChange: vi.fn(), onViewDesktop: vi.fn() } }
}

const wrapper = ({ children }: { children: ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>

it('没有桌面连接和脚本草稿时进入自动化即预热，切换编辑页和历史不重复请求', async () => {
  const { props, gateway, runtime } = fixture()
  const view = render(<WorkflowWorkspace {...props} />, { wrapper })
  try {
    await waitFor(() => expect(runtime.warmup).toHaveBeenCalledTimes(1))
    const status = screen.getByRole('button', { name: 'settings.aiRuntime.cpu' })
    expect(status).toBeVisible()
    const header = within(status.closest('header')!)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.analysis.analyze' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.create' }))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' })).toBeDisabled()
    fireEvent.click(header.getByRole('button', { name: 'desktopWorkflow.executionHistory' }))
    fireEvent.click(header.getByRole('button', { name: 'desktopWorkflow.backToEditor' }))
    expect(screen.getAllByRole('button', { name: 'settings.aiRuntime.cpu' })).toHaveLength(1)
    expect(runtime.warmup).toHaveBeenCalledTimes(1)
    expect(gateway.openPreview).not.toHaveBeenCalled()
    expect(gateway.capture).not.toHaveBeenCalled()
  } finally { view.unmount() }
})

it.each([{ active: false }, { guided: true }])('隐藏工作区或向导不触发预热，正常进入后才准备：%j', async initial => {
  const { props, runtime } = fixture()
  const view = render(<WorkflowWorkspace {...props} {...initial} />, { wrapper })
  try {
    await screen.findByRole('button', { name: 'settings.aiRuntime.cpu' })
    expect(runtime.warmup).not.toHaveBeenCalled()
    view.rerender(<WorkflowWorkspace {...props} active guided={false} />)
    await waitFor(() => expect(runtime.warmup).toHaveBeenCalledTimes(1))
  } finally { view.unmount() }
})

it('页面隐藏期间服务重启，重新进入时预热新实例', async () => {
  const { props, runtime } = fixture()
  const view = render(<WorkflowWorkspace {...props} />, { wrapper })
  try {
    await waitFor(() => expect(runtime.warmup).toHaveBeenCalledTimes(1))
    vi.mocked(runtime.serviceStatus).mockResolvedValue({ state: 'idle', device: 'cuda', instance_id: 'second' })
    view.rerender(<WorkflowWorkspace {...props} active={false} />)
    await screen.findByRole('button', { name: 'settings.aiRuntime.gpu' })
    expect(runtime.warmup).toHaveBeenCalledTimes(1)
    view.rerender(<WorkflowWorkspace {...props} active />)
    await waitFor(() => expect(runtime.warmup).toHaveBeenCalledTimes(2))
  } finally { view.unmount() }
})

it('工作区头部打开推理设置失败时显示操作错误', async () => {
  const { props } = fixture()
  const settings = vi.fn().mockRejectedValue(new Error('设置暂不可用'))
  const view = render(<WorkflowWorkspace {...props} onOpenAnalysisSettings={settings} />, { wrapper })
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'settings.aiRuntime.cpu' }))
    expect(await screen.findByText('设置暂不可用')).toBeVisible()
    expect(settings).toHaveBeenCalledTimes(1)
  } finally { view.unmount() }
})
