import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { DetachedConnection, DetachedOwnerBridge, DetachedPacket } from '#common/contracts'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopWorkspaceProps } from '#widgets/remote-desktop-workspace'
import { DetachedWorkflowSurface } from '#features/desktop-workflows'
import { DetachedClient } from '#shared/detached-window'
import { RemoteDesktopPage } from './RemoteDesktopPage'

const runtime = vi.hoisted(() => ({ sessions: [], activeSessionId: null, selectSession: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('#features/remote-desktop', () => ({ useRemoteDesktopRuntime: () => runtime }))
vi.mock('#widgets/remote-desktop-workspace', () => ({
  RemoteDesktopWorkspace: ({ tools, toolsButtonRef }: RemoteDesktopWorkspaceProps) => <section>
    <input aria-label="桌面会话状态" defaultValue="持续连接" />
    <button ref={toolsButtonRef}>桌面工具</button>
    {tools?.map(tool => <button key={tool.key} onClick={tool.onClick}>{tool.label}</button>)}
  </section>,
}))

const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>
afterEach(() => { delete (window as Window & { termous?: unknown }).termous; vi.unstubAllGlobals(); vi.clearAllMocks() })

it('独立出去后的占位页可返回远程桌面，保留会话和独立窗口草稿；从小窗返回时仍能收回同一份状态', async () => {
  vi.stubGlobal('WebSocket', class { close() {} })
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
  const gateway = { list: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), eventsURL: () => 'ws://fixture/events' } as unknown as WorkflowGateway
  const dirty = vi.fn(); const detached = vi.fn()
  const host = render(<RemoteDesktopPage workflow={gateway} profiles={[]} onDirtyChange={dirty} onDetachedChange={detached} />, { wrapper })
  const desktop = within(host.container).getByLabelText('桌面会话状态')
  const entry = within(host.container).getByRole('button', { name: 'desktopWorkflow.workflow' })
  fireEvent.click(entry)
  fireEvent.click(within(host.container).getByRole('button', { name: 'desktopWorkflow.create' }))
  fireEvent.click(within(host.container).getByRole('button', { name: 'desktopWorkflow.window.open' }))
  await waitFor(() => expect(bridge.open).toHaveBeenCalledOnce())
  const child = render(<DetachedWorkflowSurface client={client} />, { wrapper })
  try {
    await within(child.container).findByRole('button', { name: 'desktopWorkflow.editName' })
    const placeholder = within(host.container).getByRole('region', { name: 'desktopWorkflow.window.detached' })
    const back = within(placeholder).getByRole('button', { name: 'desktopWorkflow.backToDesktop' })
    expect(back.closest('header')).not.toBeNull()
    fireEvent.click(back)
    expect(desktop).toBeVisible()
    expect(within(host.container).getByRole('button', { name: '桌面工具' })).toHaveFocus()
    expect(placeholder).not.toBeVisible()
    expect(bridge.close).not.toHaveBeenCalled()
    expect(runtime.selectSession).not.toHaveBeenCalled()
    expect(detached).toHaveBeenLastCalledWith(true)

    fireEvent.click(within(child.container).getByRole('button', { name: 'desktopWorkflow.editName' }))
    fireEvent.change(within(child.container).getByRole('textbox', { name: 'desktopWorkflow.scriptName' }), { target: { value: '桌面继续使用时的草稿' } })
    expect(dirty).toHaveBeenLastCalledWith(true)
    fireEvent.click(entry)
    expect(placeholder).toBeVisible()
    expect(bridge.open).toHaveBeenCalledOnce()
    fireEvent.click(within(placeholder).getByRole('button', { name: 'desktopWorkflow.backToDesktop' }))
    fireEvent.click(within(child.container).getByRole('button', { name: 'desktopWorkflow.window.return' }))
    await waitFor(() => expect(bridge.close).toHaveBeenCalledOnce())
    expect(within(host.container).getByRole('button', { name: 'desktopWorkflow.editName' })).toHaveTextContent('桌面继续使用时的草稿')
    expect(desktop).not.toBeVisible()
    expect(detached).toHaveBeenLastCalledWith(false)
  } finally { child.unmount(); host.unmount(); client.dispose() }
})
