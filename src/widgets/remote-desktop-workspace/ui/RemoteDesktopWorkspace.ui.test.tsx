import { App as AntdApp, ConfigProvider } from 'antd'
import { fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { RemoteDesktopWorkspace } from './RemoteDesktopWorkspace'
import { remoteDesktopTabPreferencesKey } from './RemoteDesktopSessionTabs'
import { RemoteDesktopCredentialDialog } from './RemoteDesktopSecurityDialogs'

const runtimeMock = vi.hoisted(() => ({
  value: {
    sessions: [] as RemoteDesktopSession[],
    sessionsReady: true,
    hiddenSessionIds: [] as string[],
    desktopFiles: undefined as DesktopFilesGateway | undefined,
    closeViewer: vi.fn(),
    activeSessionId: null as string | null,
    viewerStates: {} as Record<string, {
      connection: string
      credentialFields: Array<{
        id: string
        kind: 'text' | 'secret'
        required: boolean
      }>
    }>,
    focusViewer: vi.fn(),
    createSession: vi.fn(async () => undefined),
    duplicateSession: vi.fn(async () => null),
    pendingSessionActionIds: new Set<string>(),
    closeSession: vi.fn(async () => undefined),
    selectSession: vi.fn(),
    setDisplayMode: vi.fn(),
    setViewOnly: vi.fn(),
    sendClipboard: vi.fn(),
    sendCtrlAltDel: vi.fn(),
    reconnectSession: vi.fn(async () => undefined),
    submitCredentials: vi.fn(),
    approveServer: vi.fn(),
    rejectServer: vi.fn(async () => undefined),
  },
}))

vi.mock('#features/remote-desktop', () => ({
  RemoteDesktopViewport: () => null,
  useRemoteDesktopRuntime: () => runtimeMock.value,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./RemoteDesktopConnectionQuality.tsx', () => ({
  RemoteDesktopConnectionQuality: () => <span>连接质量</span>,
}))

const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
function render(ui: ReactNode) {
  return renderUI(ui, { wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> })
}
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterAll(() => {
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
})

afterEach(() => {
  vi.restoreAllMocks()
  runtimeMock.value.sessions = []
  runtimeMock.value.sessionsReady = true
  runtimeMock.value.hiddenSessionIds = []
  runtimeMock.value.desktopFiles = undefined
  runtimeMock.value.activeSessionId = null
  runtimeMock.value.viewerStates = {}
  runtimeMock.value.pendingSessionActionIds = new Set()
  runtimeMock.value.closeViewer.mockReset()
  runtimeMock.value.duplicateSession.mockReset()
  runtimeMock.value.duplicateSession.mockResolvedValue(null)
  localStorage.removeItem(remoteDesktopTabPreferencesKey)
  runtimeMock.value.focusViewer.mockReset()
  runtimeMock.value.createSession.mockReset()
  runtimeMock.value.createSession.mockResolvedValue(undefined)
  runtimeMock.value.closeSession.mockReset()
  runtimeMock.value.closeSession.mockResolvedValue(undefined)
  runtimeMock.value.selectSession.mockReset()
  runtimeMock.value.setDisplayMode.mockReset()
  runtimeMock.value.setViewOnly.mockReset()
  runtimeMock.value.sendClipboard.mockReset()
  runtimeMock.value.sendCtrlAltDel.mockReset()
  runtimeMock.value.reconnectSession.mockReset()
  runtimeMock.value.reconnectSession.mockResolvedValue(undefined)
  runtimeMock.value.submitCredentials.mockReset()
  runtimeMock.value.approveServer.mockReset()
  runtimeMock.value.rejectServer.mockReset()
  runtimeMock.value.rejectServer.mockResolvedValue(undefined)
})

test('无远程桌面会话时加号打开快捷配置菜单，空状态仍打开统一连接器', async () => {
  const user = userEvent.setup()
  const onOpenConnectionLauncher = vi.fn()
  render(
    <AntdApp>
      <RemoteDesktopWorkspace
        onOpenConnectionLauncher={onOpenConnectionLauncher}
      />
    </AntdApp>,
  )

  const tablist = screen.getByRole('tablist', { name: 'remoteDesktop.sessions' })
  expect(within(tablist).getByRole('status')).toHaveTextContent('app.noSessions')
  expect(screen.getByText('remoteDesktop.emptyTitle')).toBeVisible()
  expect(screen.getByText('remoteDesktop.emptyDescription')).toBeVisible()
  const quickConnectButton = screen.getByRole('button', { name: 'remoteDesktop.newConnection' })
  const newConnectionButton = screen.getByRole('button', { name: 'app.newConnection' })

  await user.click(quickConnectButton)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'workbench.quickConnect.profiles.remoteDesktop' })).toBeVisible())
  expect(onOpenConnectionLauncher).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'workbench.quickConnect.moreConnections' }))
  expect(onOpenConnectionLauncher).toHaveBeenCalledTimes(1)
  await user.click(newConnectionButton)

  expect(onOpenConnectionLauncher).toHaveBeenCalledTimes(2)
})

test.each(['vnc', 'rdp'] as const)('桌面加号选择 %s 配置时调用原有 runtime 连接逻辑', async (protocol) => {
  const base = {
    id: 'desktop-profile', host_id: 'host-a', name: 'Maintenance desktop', description: '',
    route: 'direct' as const, route_config_version: 1 as const, protocol_config_version: 1 as const,
    target_auth: null, is_default: true, sort_order: 0, created_at: '', updated_at: '',
  }
  const profiles: RemoteDesktopAccessProfile[] = protocol === 'vnc' ? [{ ...base, protocol, vnc: {
    target_host: '192.0.2.10', port: 5900, shared: true, default_view_only: false, default_display_mode: 'fit',
  } }] : [{ ...base, protocol, rdp: {
    target_host: '192.0.2.10', port: 3389, server_name: '', username: '', domain: '',
    width: 1280, height: 720, audio: false, default_view_only: false, default_display_mode: 'fit',
  } }]
  render(<AntdApp><RemoteDesktopWorkspace profiles={profiles} hosts={[{ id: 'host-a', name: 'Server A' }]} /></AntdApp>)
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.newConnection' }))
  fireEvent.click(await screen.findByRole('button', { name: /Maintenance desktop/ }))
  await waitFor(() => expect(runtimeMock.value.createSession).toHaveBeenCalledExactlyOnceWith('desktop-profile'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('启动快照就绪前保留标签偏好，就绪后只清理已移除的会话', () => {
  const session = remoteDesktopSession('restored')
  const saved = { [session.id]: { title: '维护桌面', pinned: true, pinnedAt: 1 }, removed: { title: '已移除' } }
  localStorage.setItem(remoteDesktopTabPreferencesKey, JSON.stringify(saved))
  runtimeMock.value.sessionsReady = false
  const view = render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)).toEqual(saved)

  runtimeMock.value.sessions = [session]
  runtimeMock.value.sessionsReady = true
  view.rerender(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(screen.getByRole('tab', { name: /^维护桌面/ })).toBeVisible()
  expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)).toEqual({ [session.id]: saved[session.id] })

  runtimeMock.value.sessions = []
  view.rerender(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)).toEqual({})
})

test.each([false, true])('桌面工具在有无会话时均可进入自动化，当前连接状态为 %s', async (connected) => {
  const onOpen = vi.fn()
  if (connected) {
    const session = remoteDesktopSession('rds_status_action')
    runtimeMock.value.sessions = [session]
    runtimeMock.value.activeSessionId = session.id
    runtimeMock.value.viewerStates = { [session.id]: { connection: 'connected', credentialFields: [] } }
  }
  render(<AntdApp><RemoteDesktopWorkspace tools={[{ key: 'automation', label: '桌面自动化', icon: null, onClick: onOpen }]} /></AntdApp>)
  const trigger = screen.getByRole('button', { name: 'remoteDesktop.tools.title' })
  expect(trigger.closest('header')).not.toBeNull()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  if (connected) expect(screen.getByText('连接质量').closest('footer')).not.toBeNull()
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('menuitem', { name: '桌面自动化' }))
  expect(onOpen).toHaveBeenCalledOnce()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(runtimeMock.value.closeSession).not.toHaveBeenCalled()
})

test('保留会话归属独立菜单，通过原有选择操作恢复观看', async () => {
  const retained = remoteDesktopSession('retained-desktop')
  runtimeMock.value.sessions = [retained]
  runtimeMock.value.hiddenSessionIds = [retained.id]
  render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(screen.queryByRole('button', { name: 'remoteDesktop.tools.title' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: 'remoteDesktop.tools.retainedCount' })
  expect(trigger).toHaveTextContent('1')
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('menuitem', { name: /retained-desktop/ }))
  expect(runtimeMock.value.selectSession).toHaveBeenCalledWith(retained.id)
  expect(runtimeMock.value.createSession).not.toHaveBeenCalled()
})

test('文件入口按能力显示，使用键盘打开工具菜单后进入既有文件面板', async () => {
  const retained = vi.fn(async () => [])
  runtimeMock.value.desktopFiles = { retained, tasks: vi.fn(async () => []) } as unknown as DesktopFilesGateway
  render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  const trigger = screen.getByRole('button', { name: 'remoteDesktop.tools.title' })
  trigger.focus()
  await userEvent.keyboard('{ArrowDown}')
  await screen.findByRole('menuitem', { name: /remoteDesktop.tools.files/ })
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.click(await screen.findByRole('menuitem', { name: /remoteDesktop.tools.files/ }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('remoteDesktop.files.workspaceTitle')
  await waitFor(() => expect(retained).toHaveBeenCalled())
})

test('RDP 工具菜单只提供文件和自动化的单行入口', async () => {
  const session = remoteDesktopSession('rdp-desktop')
  session.protocol = 'rdp'
  runtimeMock.value.sessions = [session]
  runtimeMock.value.activeSessionId = session.id
  runtimeMock.value.desktopFiles = { retained: vi.fn(async () => []), tasks: vi.fn(async () => []) } as unknown as DesktopFilesGateway
  render(<AntdApp><RemoteDesktopWorkspace tools={[{ key: 'automation', label: '桌面自动化', icon: null, onClick: vi.fn() }]} /></AntdApp>)
  await userEvent.click(screen.getByRole('button', { name: 'remoteDesktop.tools.title' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['remoteDesktop.tools.files', '桌面自动化'])
  expect(menu.querySelector('small')).toBeNull()
  expect(runtimeMock.value.createSession).not.toHaveBeenCalled()
  expect(runtimeMock.value.closeSession).not.toHaveBeenCalled()
})

test('远程桌面凭据弹窗断开失败时显示错误且不产生未处理拒绝', async () => {
  const user = userEvent.setup()
  const session = remoteDesktopSession('rds_close_failure')
  runtimeMock.value.viewerStates = {
    [session.id]: {
      connection: 'credentials_required',
      credentialFields: [{ id: 'password', kind: 'secret', required: true }],
    },
  }
  runtimeMock.value.closeSession.mockRejectedValueOnce(new Error('close failed'))

  render(
    <AntdApp>
      <RemoteDesktopCredentialDialog session={session} />
    </AntdApp>,
  )

  await user.click(await findButton('remoteDesktop.disconnect'))

  expect(runtimeMock.value.closeSession).toHaveBeenCalledWith(session.id)
  await waitFor(() => {
    expect(document.body).toHaveTextContent('remoteDesktop.disconnectFailed')
    expect(document.body).toHaveTextContent('close failed')
  })
})

test('切换到另一远程桌面会话时清空未提交的认证材料', async () => {
  const first = remoteDesktopSession('rds_first')
  const second = remoteDesktopSession('rds_second')
  runtimeMock.value.viewerStates = {
    [first.id]: {
      connection: 'credentials_required',
      credentialFields: [{ id: 'password', kind: 'secret', required: true }],
    },
    [second.id]: {
      connection: 'credentials_required',
      credentialFields: [{ id: 'password', kind: 'secret', required: true }],
    },
  }
  const tree = (session: RemoteDesktopSession) => (
    <AntdApp>
      <RemoteDesktopCredentialDialog session={session} />
    </AntdApp>
  )
  const view = render(tree(first))
  const firstInput = await passwordInput()
  fireEvent.change(firstInput, { target: { value: 'session-a-secret' } })
  expect(firstInput.value).toBe('session-a-secret')

  view.rerender(tree(second))

  await waitFor(async () => {
    expect((await passwordInput()).value).toBe('')
  })
  expect(runtimeMock.value.submitCredentials).not.toHaveBeenCalled()
})

test('桌面标签提供六项右键操作，后台标签操作指向自身会话且不会切换当前桌面', async () => {
  const first = remoteDesktopSession('first')
  const second = remoteDesktopSession('second')
  runtimeMock.value.sessions = [first, second]
  runtimeMock.value.activeSessionId = first.id
  render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^second/ }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(
    ['duplicate', 'restart', 'rename', 'pin', 'color', 'reset'].map((key) => `terminal.tabMenu.${key}`),
  )
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'terminal.tabMenu.duplicate' }))
  await waitFor(() => expect(runtimeMock.value.duplicateSession).toHaveBeenCalledWith(second.id))
  await desktopTabAction('second', 'restart')
  expect(runtimeMock.value.reconnectSession).toHaveBeenCalledWith(second.id)
  expect(runtimeMock.value.selectSession).not.toHaveBeenCalled()
  expect(runtimeMock.value.closeSession).not.toHaveBeenCalled()
})

test('桌面标签改名、固定和颜色持久保存，保留会话不会丢失外观', async () => {
  const first = remoteDesktopSession('first')
  const second = remoteDesktopSession('second')
  runtimeMock.value.sessions = [first, second]
  runtimeMock.value.activeSessionId = first.id
  const view = render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  await desktopTabAction('second', 'rename')
  fireEvent.change(screen.getByRole('textbox', { name: 'terminal.tabMenu.renameTitle' }), { target: { value: '  Maintenance  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'app.confirm' }))
  await desktopTabAction('Maintenance', 'pin')
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Maintenance')
  await desktopTabAction('Maintenance', 'color')
  fireEvent.click((await screen.findAllByRole('button', { name: 'terminal.tabMenu.colorValue' }))[0])
  await waitFor(() => expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)[second.id]).toMatchObject({
    title: 'Maintenance', pinned: true, color: '#e11d48',
  }))
  runtimeMock.value.hiddenSessionIds = [second.id]
  view.rerender(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(screen.queryByRole('tab', { name: /^Maintenance/ })).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)[second.id].title).toBe('Maintenance')
  view.unmount()
  runtimeMock.value.hiddenSessionIds = []
  render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Maintenance')
  await desktopTabAction('Maintenance', 'reset')
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('first')
  expect(JSON.parse(localStorage.getItem(remoteDesktopTabPreferencesKey)!)).toEqual({})
  expect(runtimeMock.value.selectSession).not.toHaveBeenCalled()
})

test('RDP 标签禁止复制，关闭仍只保留桌面会话；连接期间禁用重启', async () => {
  const session = { ...remoteDesktopSession('rdp-tab'), protocol: 'rdp' as const, status: 'connecting' as const }
  runtimeMock.value.sessions = [session]
  runtimeMock.value.activeSessionId = session.id
  render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^rdp-tab/ }))
  expect(await screen.findByRole('menuitem', { name: 'terminal.tabMenu.duplicate' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: 'terminal.tabMenu.restart' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.mouseDown(document.body)
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.rdp.closeViewer' }))
  expect(runtimeMock.value.closeViewer).toHaveBeenCalledWith(session.id)
  expect(runtimeMock.value.closeSession).not.toHaveBeenCalled()
})

test('桌面标签复制失败提示错误，在途状态同时禁用标签和工具栏重连', async () => {
  const session = remoteDesktopSession('failed-copy')
  runtimeMock.value.sessions = [session]
  runtimeMock.value.activeSessionId = session.id
  runtimeMock.value.duplicateSession.mockRejectedValueOnce(new Error('duplicate failed'))
  const view = render(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  await desktopTabAction(session.id, 'duplicate')
  await waitFor(() => expect(document.body).toHaveTextContent('remoteDesktop.duplicateFailed'))
  expect(document.body).toHaveTextContent('duplicate failed')
  runtimeMock.value.pendingSessionActionIds = new Set([session.id])
  view.rerender(<AntdApp><RemoteDesktopWorkspace /></AntdApp>)
  expect(screen.getByRole('button', { name: 'remoteDesktop.reconnect' })).toBeDisabled()
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^failed-copy/ }))
  expect(await screen.findByRole('menuitem', { name: 'terminal.tabMenu.duplicate' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: 'terminal.tabMenu.restart' })).toHaveAttribute('aria-disabled', 'true')
})

test('桌面标签引用 AI 助手携带所选会话及当前连接代次', async () => {
  const session = remoteDesktopSession('reference-desktop')
  runtimeMock.value.sessions = [session]
  runtimeMock.value.activeSessionId = session.id
  const source = { kind: 'desktop_session' as const, session_id: session.id, connection_generation: session.connection_generation,
    desktop_profile_id: session.profile_id, desktop_profile_name: session.profile_name, host_id: session.host_id,
    host_name: session.host_name, protocol: session.protocol, status: 'ready' as const }
  const getSnapshot = vi.fn(() => ({ ready: true, source, targets: [] }))
  const onReference = vi.fn()
  render(<AntdApp><RemoteDesktopWorkspace getAgentConnectionReferenceSnapshot={getSnapshot} onReferenceAgentConnection={onReference} /></AntdApp>)
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^reference-desktop/ }))
  fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /agent.launch.action/ }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'terminal.aiReference.newSession' }))
  expect(getSnapshot).toHaveBeenCalledWith({ kind: 'desktop_session', session_id: session.id, connection_generation: session.connection_generation })
  expect(onReference).toHaveBeenCalledWith(source, { kind: 'new' })
})

async function desktopTabAction(title: string, key: string) {
  fireEvent.contextMenu(screen.getByRole('tab', { name: new RegExp(`^${title}(?:[， ]|$)`) }))
  const item = await screen.findByRole('menuitem', { name: `terminal.tabMenu.${key}` })
  await waitFor(() => expect(item).toBeVisible())
  fireEvent.click(item)
}

async function passwordInput() {
  let input: HTMLInputElement | null = null
  await waitFor(() => {
    input = document.querySelector('input[type="password"]')
    expect(input).not.toBeNull()
  })
  return input!
}

async function findButton(name: string) {
  let button: HTMLButtonElement | null = null
  await waitFor(() => {
    button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.trim() === name) ?? null
    expect(button).not.toBeNull()
  })
  return button!
}

function remoteDesktopSession(id: string): RemoteDesktopSession {
  return {
    id,
    profile_id: `profile_${id}`,
    profile_name: id,
    host_id: 'hst_test',
    host_name: 'Test host',
    ssh_profile_id: 'ssh_test',
    route: 'ssh_tunnel',
    route_config_version: 1,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      target_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status: 'streaming',
    phase: 'streaming',
    status_message: 'streaming',
    connection_generation: 1,
    viewer_attached: true,
    reconnect_attempt: 0,
    reconnect_max_attempts: 3,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}
