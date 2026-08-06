import fs from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  const action = vi.fn(async () => undefined)
  return {
    action,
    persistentStateSetter: vi.fn(),
    workbenchMounts: 0,
    workbenchUnmounts: 0,
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
      notification: {
        error: vi.fn(),
        success: vi.fn(),
      },
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

vi.mock('../features/files/FilesWorkspaceRuntimeProvider', () => ({
  FilesWorkspaceRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="files-workspace">{children}</div>
  ),
}))

vi.mock('#app/transfer-runtime', () => ({
  TransferRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="transfer">{children}</div>
  ),
}))

vi.mock('../features/terminal/TerminalRuntimeProvider', () => ({
  TerminalRuntimeProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="terminal">{children}</div>
  ),
}))

vi.mock('../components/layout/AppShell', () => ({
  AppShell: ({
    children,
    onNavigate,
  }: {
    children: ReactNode
    onNavigate: (page: 'workbench' | 'hosts') => void
  }) => (
    <div data-provider="app-shell">
      <button type="button" onClick={() => onNavigate('workbench')}>workbench</button>
      <button type="button" onClick={() => onNavigate('hosts')}>hosts</button>
      {children}
    </div>
  ),
}))

vi.mock('../features/workbench/WorkbenchPage', () => ({
  WorkbenchPage: ({ active }: { active: boolean }) => {
    useEffect(() => {
      testState.workbenchMounts += 1
      return () => {
        testState.workbenchUnmounts += 1
      }
    }, [])
    return <div data-testid="workbench" data-active={String(active)}>Workbench</div>
  },
}))

vi.mock('#pages/hosts', () => ({
  HostsPage: () => <div data-testid="hosts-page">Hosts</div>,
}))

vi.mock('../features/files/FilesPage', () => ({ FilesPage: () => null }))
vi.mock('../features/forwards/ForwardingPage', () => ({ ForwardingPage: () => null }))
vi.mock('#pages/settings', () => ({ SettingsPage: () => null }))
vi.mock('../features/snippets/SnippetsPage', () => ({ SnippetsPage: () => null }))
vi.mock('#pages/vault', () => ({ VaultPage: () => null }))
vi.mock('#features/hosts', () => ({
  HostLauncherModal: () => null,
  HostKeyCoordinator: () => null,
  hostLauncherIntentForPage: (page: string) => page === 'files' ? 'files' : 'terminal',
}))
vi.mock('#shared/ui', () => ({ ConfirmDialog: () => null }))
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

vi.mock('../app/useTermousData', () => ({
  useTermousData: () => ({
    api: {},
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

import App from '../App'

const workstationStyles = fs.readFileSync(
  path.join(process.cwd(), 'src/styles/workstation.css'),
  'utf8',
)
const workstationStyleElement = document.createElement('style')
workstationStyleElement.textContent = workstationStyles

function directProviderChild(element: Element) {
  return Array.from(element.children).find((child) => child.hasAttribute('data-provider'))
}

describe('应用运行时组合合同', () => {
  beforeAll(() => {
    document.head.append(workstationStyleElement)
  })

  afterAll(() => {
    workstationStyleElement.remove()
  })

  beforeEach(() => {
    testState.workbenchMounts = 0
    testState.workbenchUnmounts = 0
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
})
