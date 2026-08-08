import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
    filesPageMounts: 0,
    filesPageUnmounts: 0,
    projectionKeys: {
      workbench: [] as string[],
      hosts: [] as string[],
      files: [] as string[],
      forwards: [] as string[],
      snippets: [] as string[],
      hostLauncher: [] as string[],
    },
    data: {
      hosts: [],
      groups: [],
      proxies: [],
      credentials: [],
      sessions: [],
      fileSessions: [],
      forwardProfiles: [],
      forwards: [],
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

vi.mock('#app/app-shell', () => ({
  AppShell: ({
    children,
    onNavigate,
  }: {
    children: ReactNode
    onNavigate: (page: 'workbench' | 'hosts' | 'files' | 'forwards' | 'snippets') => void
  }) => (
    <div data-provider="app-shell">
      <button type="button" onClick={() => onNavigate('workbench')}>workbench</button>
      <button type="button" onClick={() => onNavigate('hosts')}>hosts</button>
      <button type="button" onClick={() => onNavigate('files')}>files</button>
      <button type="button" onClick={() => onNavigate('forwards')}>forwards</button>
      <button type="button" onClick={() => onNavigate('snippets')}>snippets</button>
      {children}
    </div>
  ),
}))

vi.mock('#widgets/workbench', () => ({
  WorkbenchPage: ({
    active,
    data,
    onSnippetUsed,
  }: {
    active: boolean
    data: Record<string, unknown>
    onSnippetUsed?: (snippetId: string) => Promise<void>
  }) => {
    testState.projectionKeys.workbench = Object.keys(data).sort()
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
  HostsPage: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.hosts = Object.keys(data).sort()
    return <div data-testid="hosts-page">Hosts</div>
  },
}))

vi.mock('#pages/files', () => ({
  FilesPage: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.files = Object.keys(data).sort()
    useEffect(() => {
      testState.filesPageMounts += 1
      return () => {
        testState.filesPageUnmounts += 1
      }
    }, [])
    return <div data-testid="files-page">Files</div>
  },
  canCommitFilesBookmarkManagementRequest: () => false,
  consumeFilesBookmarkManagementIntent: () => null,
}))
vi.mock('#pages/forwards', () => ({
  ForwardsPage: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.forwards = Object.keys(data).sort()
    return null
  },
}))
vi.mock('#pages/settings', () => ({ SettingsPage: () => null }))
vi.mock('#pages/snippets', () => ({
  SnippetsPage: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.snippets = Object.keys(data).sort()
    return null
  },
}))
vi.mock('#pages/vault', () => ({ VaultPage: () => null }))
vi.mock('#features/hosts', () => ({
  HostLauncherModal: ({ data }: { data: Record<string, unknown> }) => {
    testState.projectionKeys.hostLauncher = Object.keys(data).sort()
    return null
  },
  HostKeyCoordinator: () => null,
  hostLauncherIntentForPage: (page: string) => page === 'files' ? 'files' : 'terminal',
}))
vi.mock('#shared/ui', () => ({
  confirmDialogStyles: {
    'modal-root': 'modal-root',
    'modal-wrap': 'modal-wrap',
  },
  ConfirmDialog: () => null,
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
      hosts: {},
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
    testState.filesPageMounts = 0
    testState.filesPageUnmounts = 0
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
      'credentials',
      'fileBookmarkGroups',
      'fileBookmarks',
      'fileSessions',
      'forwards',
      'groups',
      'hostReachability',
      'hosts',
      'proxies',
      'sessions',
      'settings',
      'snippetGroups',
      'snippets',
    ])
    expect(testState.projectionKeys.hostLauncher).toEqual([
      'credentials',
      'groups',
      'hostReachability',
      'hosts',
      'proxies',
    ])

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    expect(testState.projectionKeys.hosts).toEqual(['credentials', 'groups', 'hosts', 'proxies'])

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
    expect(testState.projectionKeys.forwards).toEqual(['forwardProfiles', 'forwards', 'hosts'])

    await user.click(screen.getByRole('button', { name: 'snippets' }))
    expect(testState.projectionKeys.snippets).toEqual(['snippetGroups', 'snippets'])
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
