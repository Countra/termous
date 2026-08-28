import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  const action = vi.fn(async () => undefined)
  return {
    action,
    notifications: {
      error: vi.fn(),
      success: vi.fn(),
    },
    persistentStateSetter: vi.fn(),
    workbenchMounts: 0,
    workbenchUnmounts: 0,
    agentMounts: 0,
    agentUnmounts: 0,
    filesPageMounts: 0,
    filesPageUnmounts: 0,
    workbenchForwardsIsArray: false,
    workbenchHostIconURL: '',
    hostAccessIntent: null as { key: number; hostId: string } | null,
    onAccessIntentHandled: null as ((key: number) => void) | null,
    onManageHostAccess: null as ((hostId: string) => void) | null,
    launcherOpen: false,
    launcherIntent: 'terminal',
    onLauncherClose: null as (() => void) | null,
    onConnectSSHProfile: null as ((profileId: string) => Promise<void>) | null,
    onOpenFileProfile: null as ((profileId: string, hostId: string) => Promise<void>) | null,
    onOpenForward: null as ((hostId: string, sshProfileId: string) => void) | null,
    forwardTemporaryIntent: null as {
      key: number
      hostId: string
      sshProfileId: string
    } | null,
    onForwardTemporaryIntentHandled: null as ((key: number) => void) | null,
    projectionKeys: {
      workbench: [] as string[],
      workbenchHostView: [] as string[],
      workbenchSessionView: [] as string[],
      workbenchFilesView: [] as string[],
      workbenchSnippetView: [] as string[],
      hosts: [] as string[],
      files: [] as string[],
      forwards: [] as string[],
      snippets: [] as string[],
      hostLauncher: [] as string[],
    },
    data: {
      hosts: [],
      hostAssets: [],
      groups: [],
      hostIcons: [{
        id: 'icon-a',
        display_name: 'Icon A',
        file_name: 'icon-a.png',
        mime_type: 'image/png',
        size_bytes: 128,
        sha256: 'sha-icon-a',
        sort_order: 0,
        created_at: '2026-08-11T00:00:00Z',
      }],
      proxies: [],
      credentials: [],
      sessions: [],
      fileSessions: [],
      sshAccessProfiles: [] as Array<Record<string, unknown>>,
      fileAccessProfiles: [] as Array<Record<string, unknown>>,
      forwardProfiles: [],
      forwards: [],
      remoteDesktopProfiles: [] as Array<Record<string, unknown>>,
      remoteDesktopSessions: [],
      snippetGroups: [],
      snippets: [],
      fileBookmarkGroups: [],
      fileBookmarks: [],
      localPathMappings: [],
      settings: {
        language: 'zh-CN',
        appearance: { theme: 'dark' },
        terminal: {
          font_family: 'jetbrains_mono',
          font_size: 13,
          line_height: 1.2,
          letter_spacing: 0,
          cursor_style: 'block',
          cursor_blink: true,
          theme_mode: 'follow_app',
          scrollback: 5000,
        },
        completion: {
          enabled: true,
          providers: {
            native: true,
            alias: true,
            snippet: true,
            history: true,
            directory: true,
          },
        },
        shortcuts: { schema_version: 1, overrides: {} },
        window: { close_behavior: 'exit' },
      },
      terminalFonts: [],
      hostReachability: {},
    },
  }
})

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      notification: testState.notifications,
    }),
  },
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) => (
    open ? <div>{children}</div> : null
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

vi.mock('#app/ui-runtime', () => ({
  TermousUiProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="termous-ui">{children}</div>
  ),
}))

vi.mock('#app/update-runtime', () => ({
  UpdateRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="update">{children}</div>
  ),
  UpdateRuntimeSummaryReporter: () => null,
}))

vi.mock('#app/shortcut-runtime', () => ({
  ShortcutRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="shortcut">{children}</div>
  ),
  ShortcutWindowAdapter: () => null,
}))

vi.mock('#widgets/files-workspace', () => ({
  FilesWorkspaceRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="files-workspace">{children}</div>
  ),
}))

vi.mock('#app/transfer-runtime', () => ({
  TransferRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="transfer">{children}</div>
  ),
}))

vi.mock('#features/terminal', () => ({
  TerminalRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="terminal">{children}</div>
  ),
}))

vi.mock('#features/command-dispatch', () => ({
  CommandDispatchRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="command-dispatch">{children}</div>
  ),
}))

vi.mock('#features/mcp-access', () => ({
  McpAccessRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="mcp-access">{children}</div>
  ),
  McpApprovalCoordinator: () => null,
}))

vi.mock('#features/remote-desktop', () => ({
  RemoteDesktopRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="remote-desktop">{children}</div>
  ),
  useRemoteDesktopRuntime: () => ({ createSession: vi.fn() }),
}))

vi.mock('#app/app-shell', () => ({
  AppShell: ({
    children,
    onNavigate,
    onOpenConnectionLauncher,
  }: {
    children: ReactNode
    onNavigate: (page: 'workbench' | 'agent' | 'hosts' | 'vault' | 'files' | 'forwards' | 'snippets' | 'remote-desktop') => void
    onOpenConnectionLauncher: () => void
  }) => (
    <div data-provider="app-shell">
      <button type="button" onClick={onOpenConnectionLauncher}>global-connect</button>
      <button type="button" onClick={() => onNavigate('workbench')}>workbench</button>
      <button type="button" onClick={() => onNavigate('agent')}>agent</button>
      <button type="button" onClick={() => onNavigate('hosts')}>hosts</button>
      <button type="button" onClick={() => onNavigate('vault')}>vault</button>
      <button type="button" onClick={() => onNavigate('files')}>files</button>
      <button type="button" onClick={() => onNavigate('forwards')}>forwards</button>
      <button type="button" onClick={() => onNavigate('snippets')}>snippets</button>
      <button type="button" onClick={() => onNavigate('remote-desktop')}>remote-desktop</button>
      {children}
    </div>
  ),
}))

vi.mock('#pages/agent', () => ({
  AgentPage: ({ active }: { active: boolean }) => {
    useEffect(() => {
      testState.agentMounts += 1
      return () => {
        testState.agentUnmounts += 1
      }
    }, [])
    return <div data-testid="agent-page" data-active={String(active)}>Agent</div>
  },
}))

vi.mock('#widgets/workbench', () => ({
  WorkbenchPage: (props: {
    active: boolean
    hostView: Record<string, unknown>
    sessionView: Record<string, unknown>
    filesView: Record<string, unknown>
    forwards: unknown[]
    snippetView: Record<string, unknown>
    data?: unknown
    getHostIconUrl: (iconId: string) => string
    onSnippetUsed?: (snippetId: string) => Promise<void>
  }) => {
    const {
      active,
      hostView,
      sessionView,
      filesView,
      forwards,
      snippetView,
      getHostIconUrl,
      onSnippetUsed,
    } = props
    testState.projectionKeys.workbench = [
      'data',
      'filesView',
      'forwards',
      'hostView',
      'sessionView',
      'snippetView',
    ].filter((key) => Object.prototype.hasOwnProperty.call(props, key)).sort()
    testState.projectionKeys.workbenchHostView = Object.keys(hostView).sort()
    testState.projectionKeys.workbenchSessionView = Object.keys(sessionView).sort()
    testState.projectionKeys.workbenchFilesView = Object.keys(filesView).sort()
    testState.projectionKeys.workbenchSnippetView = Object.keys(snippetView).sort()
    testState.workbenchForwardsIsArray = Array.isArray(forwards)
    testState.workbenchHostIconURL = getHostIconUrl('icon-a')
    const [snippetUsageState, setSnippetUsageState] = useState('idle')
    useEffect(() => {
      testState.workbenchMounts += 1
      return () => {
        testState.workbenchUnmounts += 1
      }
    }, [])
    return (
      <>
        <div data-testid="workbench" data-active={String(active)}>Workbench</div>
        {active ? (
          <>
            <button
              type="button"
              onClick={() => {
                void onSnippetUsed?.('snippet-a').then(
                  () => setSnippetUsageState('fulfilled'),
                  () => setSnippetUsageState('rejected'),
                )
              }}
            >
              snippet-used
            </button>
            <output data-testid="snippet-usage-state">{snippetUsageState}</output>
          </>
        ) : null}
      </>
    )
  },
}))

vi.mock('#pages/hosts', () => ({
  HostsPage: ({
    data,
    onDirtyChange,
    accessIntent,
    onAccessIntentHandled,
  }: {
    data: Record<string, unknown>
    onDirtyChange: (dirty: boolean) => void
    accessIntent?: { key: number; hostId: string } | null
    onAccessIntentHandled?: (key: number) => void
  }) => {
    testState.projectionKeys.hosts = Object.keys(data).sort()
    testState.hostAccessIntent = accessIntent ?? null
    testState.onAccessIntentHandled = onAccessIntentHandled ?? null
    return (
      <div data-testid="hosts-page">
        Hosts
        <button type="button" onClick={() => onDirtyChange(true)}>hosts-dirty</button>
      </div>
    )
  },
}))

vi.mock('#pages/files', () => ({
  FilesPage: ({
    data,
    onOpenFileSessionLauncher,
  }: {
    data: Record<string, unknown>
    onOpenFileSessionLauncher: () => void
  }) => {
    testState.projectionKeys.files = Object.keys(data).sort()
    useEffect(() => {
      testState.filesPageMounts += 1
      return () => {
        testState.filesPageUnmounts += 1
      }
    }, [])
    return (
      <div data-testid="files-page">
        Files
        <button type="button" onClick={onOpenFileSessionLauncher}>files-connect</button>
      </div>
    )
  },
  canCommitFilesBookmarkManagementRequest: () => false,
  consumeFilesBookmarkManagementIntent: () => null,
}))
vi.mock('#pages/remote-desktop', () => ({
  RemoteDesktopPage: ({
    onOpenConnectionLauncher,
  }: {
    onOpenConnectionLauncher: () => void
  }) => (
    <div data-testid="remote-desktop-page">
      Remote Desktop
      <button type="button" onClick={onOpenConnectionLauncher}>remote-desktop-connect</button>
    </div>
  ),
}))
vi.mock('#pages/forwards', () => ({
  ForwardsPage: ({
    data,
    temporaryIntent,
    onTemporaryIntentHandled,
  }: {
    data: Record<string, unknown>
    temporaryIntent?: {
      key: number
      hostId: string
      sshProfileId: string
    } | null
    onTemporaryIntentHandled: (key: number) => void
  }) => {
    testState.projectionKeys.forwards = Object.keys(data).sort()
    testState.forwardTemporaryIntent = temporaryIntent ?? null
    testState.onForwardTemporaryIntentHandled = onTemporaryIntentHandled
    return <div data-testid="forwards-page">Forwards</div>
  },
}))
vi.mock('#pages/settings', () => ({ SettingsPage: () => null }))
vi.mock('#pages/snippets', () => ({
  SnippetsPage: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.snippets = Object.keys(data).sort()
    return null
  },
}))
vi.mock('#pages/vault', () => ({
  VaultPage: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => (
    <div data-testid="vault-page">
      <button type="button" onClick={() => onDirtyChange(true)}>vault-dirty</button>
    </div>
  ),
}))
vi.mock('#features/hosts', () => ({
  HostLauncherModal: ({
    data,
    onManageHostAccess,
    open,
    intent,
    onClose,
    onConnectSSHProfile,
    onOpenFileProfile,
    onOpenForward,
  }: {
    data: Record<string, unknown>
    onManageHostAccess: (hostId: string) => void
    open: boolean
    intent: string
    onClose: () => void
    onConnectSSHProfile: (profileId: string) => Promise<void>
    onOpenFileProfile: (profileId: string, hostId: string) => Promise<void>
    onOpenForward: (hostId: string, sshProfileId: string) => void
  }) => {
    testState.projectionKeys.hostLauncher = Object.keys(data).sort()
    testState.onManageHostAccess = onManageHostAccess
    testState.launcherOpen = open
    testState.launcherIntent = intent
    testState.onLauncherClose = onClose
    testState.onConnectSSHProfile = onConnectSSHProfile
    testState.onOpenFileProfile = onOpenFileProfile
    testState.onOpenForward = onOpenForward
    return null
  },
  HostKeyCoordinator: () => null,
}))
vi.mock('#shared/ui', () => ({
  termousNotificationClassName: 'termous-notification',
  confirmDialogStyles: {
    'modal-root': 'modal-root',
    'modal-wrap': 'modal-wrap',
  },
  ConfirmDialog: ({
    open,
    title,
    onCancel,
    onConfirm,
  }: {
    open: boolean
    title: ReactNode
    onCancel: () => void
    onConfirm: () => void
  }) => open ? (
    <div role="dialog">
      <span>{title}</span>
      <button type="button" onClick={onCancel}>confirm-cancel</button>
      <button type="button" onClick={onConfirm}>confirm-continue</button>
    </div>
  ) : null,
}))
vi.mock('#app/update-simulation-slot', () => ({
  readDevelopmentUpdateSimulation: () => null,
}))

vi.mock('#features/update', () => ({
  useUpdateRuntime: () => ({
    bridgeAvailable: false,
    initializationFailed: false,
    retryInitialization: testState.action,
    runtimeGeneration: 0,
    setUpdatePreferences: testState.action,
    snapshot: null,
  }),
}))

vi.mock('#shared/hooks', () => ({
  usePersistentBooleanState: () => [false, testState.persistentStateSetter],
}))

vi.mock('#app/data-runtime', () => ({
  useTermousData: () => ({
    gateways: {
      forwards: {},
      hosts: {
        hostIconFileUrl: (iconId: string, sha256?: string) => (
          `http://127.0.0.1/host-icons/${iconId}?sha256=${sha256 ?? ''}`
        ),
        sshProfileReachability: async () => [],
        refreshSSHProfileReachability: async () => [],
        sshProfileReachabilityEventsUrl: () => 'ws://127.0.0.1/ssh-profile-reachability',
      },
      credentials: {},
      hostKeys: {},
      terminal: {},
      transfers: {},
      files: {},
      observability: {},
      service: {},
      docker: {},
      firewall: {},
      alias: {},
      dataPortability: {},
      commandDispatch: {},
      mcpAccess: {},
      remoteDesktop: {},
    },
    data: testState.data,
    initializing: false,
    apiReady: false,
    error: null,
    activeSession: null,
    forwardErrorEvent: null,
    fileSessionClosures: {},
    actions: new Proxy({}, { get: () => testState.action }),
  }),
}))

import App from '#app/main'
import appStyles from '../app/main/App.module.scss'

const appStyleElement = document.createElement('style')
appStyleElement.textContent = `.${appStyles['app-keepalive-page']}.${appStyles['is-hidden']} { display: none; }`

function directProviderChild(element: Element) {
  return Array.from(element.children).find((child) => child.hasAttribute('data-provider'))
}

describe('应用运行时组合合同', () => {
  beforeAll(() => {
    document.head.append(appStyleElement)
  })

  afterAll(() => {
    appStyleElement.remove()
  })

  beforeEach(() => {
    testState.workbenchMounts = 0
    testState.workbenchUnmounts = 0
    testState.agentMounts = 0
    testState.agentUnmounts = 0
    testState.filesPageMounts = 0
    testState.filesPageUnmounts = 0
    testState.workbenchForwardsIsArray = false
    testState.workbenchHostIconURL = ''
    testState.hostAccessIntent = null
    testState.onAccessIntentHandled = null
    testState.onManageHostAccess = null
    testState.launcherOpen = false
    testState.launcherIntent = 'terminal'
    testState.onLauncherClose = null
    testState.onConnectSSHProfile = null
    testState.onOpenFileProfile = null
    testState.onOpenForward = null
    testState.forwardTemporaryIntent = null
    testState.onForwardTemporaryIntentHandled = null
    testState.data.sshAccessProfiles.splice(0)
    testState.data.fileAccessProfiles.splice(0)
    testState.data.remoteDesktopProfiles.splice(0)
    Object.values(testState.projectionKeys).forEach((keys) => keys.splice(0))
    testState.action.mockReset()
    testState.action.mockResolvedValue(undefined)
    testState.notifications.error.mockReset()
    testState.notifications.success.mockReset()
    window.localStorage.clear()
  })

  it('保持运行时 Provider 的既定嵌套顺序', () => {
    const { container } = render(<App />)
    const expectedOrder = [
      'termous-ui',
      'update',
      'shortcut',
      'files-workspace',
      'transfer',
      'terminal',
      'command-dispatch',
      'mcp-access',
      'remote-desktop',
      'app-shell',
    ]
    const actualOrder: string[] = []
    let current = container.querySelector('[data-provider="termous-ui"]')

    while (current) {
      actualOrder.push(current.getAttribute('data-provider') ?? '')
      current = directProviderChild(current) ?? null
    }

    expect(actualOrder).toEqual(expectedOrder)
  })

  it('只向各页面和工作区传递声明的数据视图', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(testState.projectionKeys.workbench).toEqual([
      'filesView',
      'forwards',
      'hostView',
      'sessionView',
      'snippetView',
    ])
    expect(testState.projectionKeys.workbenchHostView).toEqual([
      'credentials',
      'groups',
      'hostReachability',
      'hosts',
      'proxies',
      'sshAccessProfiles',
    ])
    expect(testState.projectionKeys.workbenchSessionView).toEqual([
      'sessions',
      'terminalSettings',
    ])
    expect(testState.projectionKeys.workbenchFilesView).toEqual([
      'fileAccessProfiles',
      'fileBookmarkGroups',
      'fileBookmarks',
      'fileSessions',
    ])
    expect(testState.projectionKeys.workbenchSnippetView).toEqual([
      'snippetGroups',
      'snippets',
    ])
    expect(testState.workbenchForwardsIsArray).toBe(true)
    expect(testState.workbenchHostIconURL).toBe(
      'http://127.0.0.1/host-icons/icon-a?sha256=sha-icon-a',
    )
    expect(testState.projectionKeys.hostLauncher).toEqual([
      'credentials',
      'fileAccessProfiles',
      'groups',
      'hostAssets',
      'hostReachability',
      'proxies',
      'remoteDesktopProfiles',
      'sshAccessProfiles',
      'sshProfileReachability',
    ])

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    expect(testState.projectionKeys.hosts).toEqual([
      'credentials',
      'fileSessions',
      'forwards',
      'groups',
      'hostAssets',
      'hostIcons',
      'hosts',
      'proxies',
      'remoteDesktopSessions',
      'sessions',
      'sshAccessProfiles',
    ])

    await user.click(screen.getByRole('button', { name: 'files' }))
    expect(testState.projectionKeys.files).toEqual([
      'fileBookmarkGroups',
      'fileBookmarks',
      'fileSessions',
      'hosts',
      'localPathMappings',
      'settings',
    ])

    await user.click(screen.getByRole('button', { name: 'forwards' }))
    expect(testState.projectionKeys.forwards).toEqual([
      'forwardProfiles',
      'forwards',
      'hosts',
      'sshAccessProfiles',
    ])

    await user.click(screen.getByRole('button', { name: 'snippets' }))
    expect(testState.projectionKeys.snippets).toEqual(['snippetGroups', 'snippets'])
  })

  it('全局连接固定使用终端场景，页面入口使用自己的访问场景', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'files' }))
    await user.click(screen.getByRole('button', { name: 'files-connect' }))
    expect(testState.launcherOpen).toBe(true)
    expect(testState.launcherIntent).toBe('files')

    await user.click(screen.getByRole('button', { name: 'global-connect' }))
    expect(testState.launcherIntent).toBe('files')

    await act(async () => testState.onLauncherClose?.())
    await user.click(screen.getByRole('button', { name: 'global-connect' }))
    expect(testState.launcherOpen).toBe(true)
    expect(testState.launcherIntent).toBe('terminal')

    await act(async () => testState.onLauncherClose?.())
    await user.click(screen.getByRole('button', { name: 'remote-desktop' }))
    await user.click(screen.getByRole('button', { name: 'remote-desktop-connect' }))
    expect(testState.launcherOpen).toBe(true)
    expect(testState.launcherIntent).toBe('remote_desktop')
  })

  it('Launcher 连接失败会保留拒绝语义并交给统一错误提示', async () => {
    const user = userEvent.setup()
    const connectError = new Error('connect failed')
    testState.action.mockRejectedValueOnce(connectError)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'global-connect' }))
    await expect(testState.onConnectSSHProfile?.('ssh-a')).rejects.toBe(connectError)

    expect(testState.launcherOpen).toBe(true)
    expect(testState.notifications.error).toHaveBeenCalledTimes(1)
  })

  it('Launcher 端口转发意图完整保留当前 SSH Profile', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'global-connect' }))
    act(() => testState.onOpenForward?.('host-a', 'ssh-secondary'))

    await waitFor(() => expect(testState.forwardTemporaryIntent).toEqual({
      key: expect.any(Number),
      hostId: 'host-a',
      sshProfileId: 'ssh-secondary',
    }))
    expect(screen.getByTestId('forwards-page')).toBeInTheDocument()

    const intentKey = testState.forwardTemporaryIntent?.key
    expect(intentKey).toEqual(expect.any(Number))
    act(() => testState.onForwardTemporaryIntentHandled?.(intentKey!))
    await waitFor(() => expect(testState.forwardTemporaryIntent).toBeNull())
  })

  it('文件 Profile 连接失败继续拒绝且不误判为打开成功', async () => {
    const user = userEvent.setup()
    const connectError = new Error('file connect failed')
    testState.data.fileAccessProfiles.push({
      id: 'file-a',
      host_id: 'host-a',
      name: 'Primary files',
      engine: 'sftp',
      engine_config_version: 1,
      sftp: { ssh_profile_id: 'ssh-a' },
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-26T00:00:00Z',
      updated_at: '2026-08-26T00:00:00Z',
    })
    testState.action.mockRejectedValueOnce(connectError)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'files' }))
    await user.click(screen.getByRole('button', { name: 'files-connect' }))
    await expect(testState.onOpenFileProfile?.('file-a', 'host-a')).rejects.toBe(connectError)

    expect(testState.launcherOpen).toBe(true)
    expect(testState.notifications.error).toHaveBeenCalledTimes(1)
  })

  it('切换页面时保留 Workbench，并通过 inert 与 active 停用', async () => {
    const user = userEvent.setup()
    render(<App />)

    const workbench = screen.getByTestId('workbench')
    const keepAlivePage = workbench.parentElement
    expect(testState.workbenchMounts).toBe(1)
    expect(testState.workbenchUnmounts).toBe(0)
    expect(workbench).toHaveAttribute('data-active', 'true')
    expect(keepAlivePage).not.toHaveAttribute('inert')
    expect(keepAlivePage).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'hosts' }))

    expect(screen.getByTestId('workbench')).toBe(workbench)
    expect(screen.getByTestId('hosts-page')).toBeInTheDocument()
    expect(testState.workbenchMounts).toBe(1)
    expect(testState.workbenchUnmounts).toBe(0)
    expect(workbench).toHaveAttribute('data-active', 'false')
    expect(keepAlivePage).toHaveAttribute('inert')
    expect(keepAlivePage).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'workbench' }))

    expect(screen.getByTestId('workbench')).toBe(workbench)
    expect(screen.queryByTestId('hosts-page')).not.toBeInTheDocument()
    expect(testState.workbenchMounts).toBe(1)
    expect(testState.workbenchUnmounts).toBe(0)
    expect(workbench).toHaveAttribute('data-active', 'true')
    expect(keepAlivePage).not.toHaveAttribute('inert')
    expect(keepAlivePage).toBeVisible()
  })

  it('Agent 工作区切页后保持挂载，并通过 inert 与 active 停用', async () => {
    const user = userEvent.setup()
    render(<App />)

    const agent = screen.getByTestId('agent-page')
    const keepAlivePage = agent.parentElement
    expect(testState.agentMounts).toBe(1)
    expect(testState.agentUnmounts).toBe(0)
    expect(agent).toHaveAttribute('data-active', 'false')
    expect(keepAlivePage).toHaveAttribute('inert')
    expect(keepAlivePage).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'agent' }))

    expect(screen.getByTestId('agent-page')).toBe(agent)
    expect(testState.agentMounts).toBe(1)
    expect(testState.agentUnmounts).toBe(0)
    expect(agent).toHaveAttribute('data-active', 'true')
    expect(keepAlivePage).not.toHaveAttribute('inert')
    expect(keepAlivePage).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'hosts' }))

    expect(screen.getByTestId('agent-page')).toBe(agent)
    expect(testState.agentMounts).toBe(1)
    expect(testState.agentUnmounts).toBe(0)
    expect(agent).toHaveAttribute('data-active', 'false')
    expect(keepAlivePage).toHaveAttribute('inert')
    expect(keepAlivePage).not.toBeVisible()
  })

  it('文件页面按需卸载，而文件工作区运行时保持常驻', async () => {
    const user = userEvent.setup()
    render(<App />)

    const runtimeProvider = document.querySelector('[data-provider="files-workspace"]')
    expect(screen.queryByTestId('files-page')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'files' }))

    expect(screen.getByTestId('files-page')).toBeInTheDocument()
    expect(testState.filesPageMounts).toBe(1)
    expect(testState.filesPageUnmounts).toBe(0)
    expect(document.querySelector('[data-provider="files-workspace"]')).toBe(runtimeProvider)

    await user.click(screen.getByRole('button', { name: 'hosts' }))

    expect(screen.queryByTestId('files-page')).not.toBeInTheDocument()
    expect(testState.filesPageMounts).toBe(1)
    expect(testState.filesPageUnmounts).toBe(1)
    expect(document.querySelector('[data-provider="files-workspace"]')).toBe(runtimeProvider)

    await user.click(screen.getByRole('button', { name: 'files' }))

    expect(screen.getByTestId('files-page')).toBeInTheDocument()
    expect(testState.filesPageMounts).toBe(2)
    expect(testState.filesPageUnmounts).toBe(1)
  })

  it('Vault 脏状态只拦截离页导航，并支持取消或确认继续', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'vault' }))
    await user.click(screen.getByRole('button', { name: 'vault-dirty' }))
    await user.click(screen.getByRole('button', { name: 'vault' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    expect(screen.getByTestId('vault-page')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('vault.unsavedTitle')

    await user.click(screen.getByRole('button', { name: 'confirm-cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('vault-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    await user.click(screen.getByRole('button', { name: 'confirm-continue' }))
    expect(screen.queryByTestId('vault-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('hosts-page')).toBeInTheDocument()
  })

  it('连续打开同一主机访问方式时使用单调递增的一次性意图', async () => {
    render(<App />)

    await act(async () => testState.onManageHostAccess?.('host-a'))
    await waitFor(() => expect(testState.hostAccessIntent).toEqual({
      key: 1,
      hostId: 'host-a',
    }))
    await act(async () => testState.onAccessIntentHandled?.(1))
    await waitFor(() => expect(testState.hostAccessIntent).toBeNull())

    await act(async () => testState.onManageHostAccess?.('host-a'))
    await waitFor(() => expect(testState.hostAccessIntent).toEqual({
      key: 2,
      hostId: 'host-a',
    }))
  })

  it('主机管理脏状态拦截离页导航，并复用统一确认流程', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    await user.click(screen.getByRole('button', { name: 'hosts-dirty' }))
    await user.click(screen.getByRole('button', { name: 'files' }))
    expect(screen.getByTestId('hosts-page')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('hosts.unsavedTitle')

    await user.click(screen.getByRole('button', { name: 'confirm-cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('hosts-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'files' }))
    await user.click(screen.getByRole('button', { name: 'confirm-continue' }))
    expect(screen.queryByTestId('hosts-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('files-page')).toBeInTheDocument()
  })

  it('片段使用次数上报失败不会阻断已完成的工作台回调', async () => {
    const user = userEvent.setup()
    testState.action.mockRejectedValueOnce(new Error('usage failed'))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'snippet-used' }))

    await waitFor(() => {
      expect(testState.action).toHaveBeenCalledWith('snippet-a')
      expect(testState.notifications.error).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('snippet-usage-state')).toHaveTextContent('fulfilled')
    })
    expect(testState.notifications.success).not.toHaveBeenCalled()
  })
})
