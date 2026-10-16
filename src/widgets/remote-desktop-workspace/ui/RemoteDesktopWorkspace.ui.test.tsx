import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { RemoteDesktopWorkspace } from './RemoteDesktopWorkspace'
import { RemoteDesktopCredentialDialog } from './RemoteDesktopSecurityDialogs'

const runtimeMock = vi.hoisted(() => ({
  value: {
    sessions: [] as RemoteDesktopSession[],
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
  runtimeMock.value.hiddenSessionIds = []
  runtimeMock.value.desktopFiles = undefined
  runtimeMock.value.activeSessionId = null
  runtimeMock.value.viewerStates = {}
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

test('无远程桌面会话时两个入口都打开统一连接器', async () => {
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
  const openButtons = screen.getAllByRole('button', { name: 'remoteDesktop.newConnection' })
  expect(openButtons).toHaveLength(2)

  await user.click(openButtons[0]!)
  await user.click(openButtons[1]!)

  expect(onOpenConnectionLauncher).toHaveBeenCalledTimes(2)
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
