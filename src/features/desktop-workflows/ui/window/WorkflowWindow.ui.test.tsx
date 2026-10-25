import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { DetachedConnection, DetachedPacket, DetachedOwnerBridge } from '#common/contracts'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { AIRuntimeGateway } from '#entities/ai-runtime'
import { DetachedClient } from '#shared/detached-window'
import { WorkflowWorkspace } from '../WorkflowWorkspace'
import { DetachedWorkflowSurface } from './DetachedWorkflowSurface'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
class SocketFixture { close() {} }
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>
afterEach(() => { delete (window as Window & { termous?: unknown }).termous; vi.unstubAllGlobals() })

function setup(navigate = vi.fn().mockResolvedValue(true), aiRuntimeGateway?: AIRuntimeGateway, active = true) {
  vi.stubGlobal('WebSocket', SocketFixture)
  const listeners = new Set<(packet: DetachedPacket) => void>()
  const connection: DetachedConnection = { module: 'desktop-workflow', instance: 'workspace', generation: 'test' }
  const client = new DetachedClient({ ...connection, appearance: { theme: 'dark', language: 'zh-CN' } }, {
    bootstrap: vi.fn(), subscribe: () => () => {}, send: packet => { for (const listener of listeners) listener(packet) },
  })
  const bridge: DetachedOwnerBridge = {
    open: vi.fn().mockResolvedValue(connection), focus: vi.fn().mockResolvedValue(true), reveal: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(async () => { for (const listener of listeners) listener({ connection, kind: 'closed' }) }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    send: packet => { if (packet.kind !== 'initialize') client.accept(packet) },
  }
  Object.defineProperty(window, 'termous', { configurable: true, value: { detachedWindows: bridge } })
  const gateway = { ocrDefaults: vi.fn().mockResolvedValue({text_confidence:.5,ocr_max_side:1600}), list: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), eventsURL: () => 'ws://fixture/events' } as unknown as WorkflowGateway
  const host = render(<WorkflowWorkspace gateway={gateway} aiRuntimeGateway={aiRuntimeGateway} active={active} sessions={[]} profiles={[]} onDirtyChange={() => {}} onViewDesktop={() => {}} onReturnToPage={navigate} />, { wrapper })
  return { host, bridge, client, connection, listeners, navigate }
}

it('主页面未激活且没有连接和草稿时，独立窗口仍通过宿主自动预热', async () => {
  const runtime: AIRuntimeGateway = {
    serviceStatus: vi.fn().mockResolvedValue({ state: 'idle', device: 'cpu', instance_id: 'fixture' }),
    warmup: vi.fn().mockResolvedValue(undefined), status: vi.fn(), download: vi.fn(), cancel: vi.fn(), check: vi.fn(),
  }
  const f = setup(undefined, runtime, false)
  let unmountChild: (() => void) | undefined
  try {
    await waitFor(() => expect(runtime.serviceStatus).toHaveBeenCalled())
    expect(runtime.warmup).not.toHaveBeenCalled()
    fireEvent.click(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.window.open' }))
    await waitFor(() => expect(f.bridge.open).toHaveBeenCalledTimes(1))
    const child = render(<DetachedWorkflowSurface client={f.client} />, { wrapper })
    unmountChild = child.unmount
    await waitFor(() => expect(runtime.warmup).toHaveBeenCalledTimes(1))
    expect(within(child.container).queryByRole('button', { name: 'desktopWorkflow.analysis.analyze' })).not.toBeInTheDocument()
    fireEvent.click(within(child.container).getByRole('button', { name: 'desktopWorkflow.window.return' }))
    await waitFor(() => expect(f.bridge.close).toHaveBeenCalledTimes(1))
    expect(runtime.warmup).toHaveBeenCalledTimes(1)
  } finally { unmountChild?.(); f.host.unmount(); f.client.dispose() }
})

it('独立窗口与主窗口交接草稿，取消导航保留小窗，确认返回后收回同一份状态', async () => {
  const f = setup(vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true))
  fireEvent.click(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.create' }))
  fireEvent.click(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.editName' }))
  fireEvent.change(within(f.host.container).getByRole('textbox', { name: 'desktopWorkflow.scriptName' }), { target: { value: '主窗口草稿' } })
  fireEvent.click(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.window.open' }))
  await waitFor(() => expect(f.bridge.open).toHaveBeenCalledTimes(1))
  const child = render(<DetachedWorkflowSurface client={f.client} />, { wrapper })
  try {
    fireEvent.click(await within(child.container).findByRole('button', { name: 'desktopWorkflow.editName' }))
    const input = within(child.container).getByRole('textbox', { name: 'desktopWorkflow.scriptName' })
    expect(input).toHaveValue('主窗口草稿')
    expect(within(f.host.container).getByText('desktopWorkflow.window.detached')).toBeVisible()
    fireEvent.change(input, { target: { value: '小窗最后输入' } })
    fireEvent.click(within(child.container).getByRole('button', { name: 'desktopWorkflow.window.return' }))
    await waitFor(() => expect(f.navigate).toHaveBeenCalledTimes(1))
    expect(f.bridge.close).not.toHaveBeenCalled()
    expect(input).toHaveValue('小窗最后输入')
    fireEvent.click(within(child.container).getByRole('button', { name: 'desktopWorkflow.window.return' }))
    await waitFor(() => expect(f.bridge.close).toHaveBeenCalledTimes(1))
    expect(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.editName' })).toHaveTextContent('小窗最后输入')
    expect(f.bridge.reveal).toHaveBeenCalledTimes(2)
  } finally { child.unmount(); f.host.unmount(); f.client.dispose() }
})

it('原生关闭只收回主窗口当前页面，不触发页面导航，也不丢弃草稿', async () => {
  const f = setup()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.create' }))
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.window.open' }))
  await waitFor(() => expect(f.bridge.open).toHaveBeenCalledTimes(1))
  const child = render(<DetachedWorkflowSurface client={f.client} />, { wrapper })
  try {
    fireEvent.click(await within(child.container).findByRole('button', { name: 'desktopWorkflow.editName' }))
    const input = within(child.container).getByRole('textbox', { name: 'desktopWorkflow.scriptName' })
    fireEvent.change(input, { target: { value: '关闭后保留' } })
    act(() => { for (const listener of f.listeners) listener({ connection: f.connection, kind: 'return', payload: false }) })
    await waitFor(() => expect(f.bridge.close).toHaveBeenCalledTimes(1))
    expect(f.navigate).not.toHaveBeenCalled()
    expect(within(f.host.container).getByRole('button', { name: 'desktopWorkflow.editName' })).toHaveTextContent('关闭后保留')
  } finally { child.unmount(); f.host.unmount(); f.client.dispose() }
})
