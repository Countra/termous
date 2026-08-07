import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeSnippet } from '#entities/snippet'
import type { AppData, Session } from '../types/domain'

const workbenchMocks = vi.hoisted(() => ({
  modalConfirm: vi.fn(),
  notification: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  sendTextToSession: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => {
  const Button = ({
    children,
    disabled,
    icon,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode
    disabled?: boolean
    icon?: ReactNode
    onClick?: () => void
    'aria-label'?: string
  }) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
      {icon}
      {children}
    </button>
  )

  return {
    App: {
      useApp: () => ({
        modal: { confirm: workbenchMocks.modalConfirm },
        notification: workbenchMocks.notification,
      }),
    },
    Button,
    Dropdown: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Input: () => null,
    Modal: () => null,
    Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Skeleton: () => null,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('#entities/host', () => ({ HostAvatar: () => null }))
vi.mock('#features/hosts', () => ({ SessionQuickConnect: () => null }))
vi.mock('#shared/hooks', () => ({
  usePersistentBooleanState: () => [false, vi.fn()],
  usePersistentJsonState: (key: string, fallback: unknown) => [
    key.includes('detailsActiveTab') ? 'snippets' : fallback,
    vi.fn(),
  ],
  useRafResizablePanelWidth: () => ({ width: 300, resizing: false, beginResize: vi.fn() }),
}))
vi.mock('#shared/path', () => ({ normalizeRemotePosixPath: (path: string) => path }))
vi.mock('#shared/ui', () => ({
  ConnectionActionButton: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  FeatureSidePanel: ({
    tabs,
  }: {
    tabs: Array<{ key: string; children: ReactNode }>
  }) => <>{tabs.find((tab) => tab.key === 'snippets')?.children}</>,
  SessionTabButton: () => null,
  SessionTabStrip: () => null,
  StatusBadge: () => null,
}))
vi.mock('../features/terminal/ConnectionProgress', () => ({ ConnectionProgress: () => null }))
vi.mock('../features/terminal/TerminalSearchPanel', () => ({ TerminalSearchPanel: () => null }))
vi.mock('../features/terminal/TerminalSplitWorkspace', () => ({ TerminalSplitWorkspace: () => null }))
vi.mock('../features/terminal/terminalRuntimeContext', () => ({
  useTerminalRuntime: () => ({
    clearActiveSearch: vi.fn(),
    focusSession: vi.fn(),
    searchActive: vi.fn(() => ({ current: 0, total: 0 })),
    sendTextToSession: workbenchMocks.sendTextToSession,
  }),
}))
vi.mock('#features/snippets', () => ({
  SnippetFilterBar: () => null,
  SnippetList: ({
    snippets,
    renderActions,
  }: {
    snippets: CodeSnippet[]
    renderActions?: (snippet: CodeSnippet) => ReactNode
  }) => (
    <>
      {snippets.map((snippet) => (
        <div key={snippet.id}>
          {renderActions?.(snippet)}
        </div>
      ))}
    </>
  ),
  buildSnippetTags: () => [],
  filterSnippets: (snippets: CodeSnippet[]) => snippets,
}))
vi.mock('#features/forwards', () => ({ ForwardSessionPanel: () => null }))
vi.mock('#features/observability', () => ({
  ProcessPanel: () => null,
  SystemMonitorPanel: () => null,
}))
vi.mock('#features/alias', () => ({ AliasPanel: () => null }))
vi.mock('#features/firewall', () => ({ FirewallPanel: () => null }))
vi.mock('../features/workbench/SessionTabColorPanel', () => ({ SessionTabColorPanel: () => null }))
vi.mock('#features/docker', () => ({ DockerPanel: () => null }))
vi.mock('#features/service', () => ({ ServicePanel: () => null }))
vi.mock('../features/workbench/WorkbenchEmptyState', () => ({ WorkbenchEmptyState: () => null }))
vi.mock('../features/workbench/WorkbenchFilesPanel', () => ({ WorkbenchFilesPanel: () => null }))

import { WorkbenchPage } from '../features/workbench/WorkbenchPage'

const activeSession = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
  host_id: 'host-a',
  pty_cols: 120,
  pty_rows: 32,
} as Session

function snippet(command: string): CodeSnippet {
  return {
    id: 'snippet-a',
    group_id: '',
    name: 'Dangerous command',
    description: '',
    command,
    tags: [],
    shell: 'bash',
    favorite: false,
    use_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function data(snippets: CodeSnippet[]): AppData {
  return {
    hosts: [],
    groups: [],
    proxies: [],
    credentials: [],
    sessions: [activeSession],
    fileSessions: [],
    forwardProfiles: [],
    forwards: [],
    snippetGroups: [],
    snippets,
    fileBookmarkGroups: [],
    fileBookmarks: [],
    localPathMappings: [],
    settings: {
      terminal: { theme_mode: 'follow_app' },
    } as AppData['settings'],
    terminalFonts: [],
    hostReachability: {},
  }
}

function renderWorkbench(
  snippets: CodeSnippet[],
  overrides: Partial<ComponentProps<typeof WorkbenchPage>> = {},
) {
  const props: ComponentProps<typeof WorkbenchPage> = {
    api: {} as never,
    data: data(snippets),
    fileSessionClosures: {},
    theme: 'dark',
    active: true,
    selectedHostId: '',
    activeSession,
    actionBusy: false,
    onOpenConnectionLauncher: vi.fn(),
    onConnect: vi.fn(async () => undefined),
    onSelectSession: vi.fn(),
    onDisconnect: vi.fn(async () => true),
    onRefreshInventory: vi.fn(async () => activeSession),
    onOpenFiles: vi.fn(async () => undefined),
    onManageBookmarks: vi.fn(async () => undefined),
    onConnectFileSession: vi.fn(async () => ({} as never)),
    onReconnectFileSession: vi.fn(async () => ({} as never)),
    onUpdateFileSession: vi.fn(),
    onCreateFileBookmark: vi.fn(async () => ({} as never)),
    onUpdateFileBookmark: vi.fn(async () => ({} as never)),
    onSnippetUsed: vi.fn(async () => undefined),
    onToggleSnippetFavorite: vi.fn(async () => undefined),
    onStartForward: vi.fn(async () => ({} as never)),
    onRestartForward: vi.fn(async () => undefined),
    onStopForward: vi.fn(async () => undefined),
    ...overrides,
  }
  return { props, ...render(<WorkbenchPage {...props} />) }
}

function latestConfirmation() {
  const calls = workbenchMocks.modalConfirm.mock.calls
  const [config] = calls[calls.length - 1] ?? []
  return config as { onOk?: () => void; onCancel?: () => void }
}

describe('工作台命令片段发送门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workbenchMocks.sendTextToSession.mockReturnValue('sent')
  })

  it('插入高风险命令不会请求确认，并且不会执行命令', async () => {
    const user = userEvent.setup()
    const view = renderWorkbench([snippet('rm -rf /tmp/cache')])

    await user.click(screen.getByRole('button', { name: 'snippets.action.insert' }))

    await waitFor(() => {
      expect(workbenchMocks.sendTextToSession).toHaveBeenCalledWith(
        activeSession.id,
        'rm -rf /tmp/cache',
        { execute: false },
      )
    })
    expect(workbenchMocks.modalConfirm).not.toHaveBeenCalled()
    expect(view.props.onSnippetUsed).toHaveBeenCalledWith('snippet-a')
    expect(workbenchMocks.notification.success).toHaveBeenCalledWith(expect.objectContaining({
      title: 'snippets.inserted',
    }))
  })

  it('高风险直接执行在取消后不发送，确认后才发送并记录使用次数', async () => {
    const user = userEvent.setup()
    const view = renderWorkbench([snippet('rm -rf /tmp/cache')])

    await user.click(screen.getByRole('button', { name: 'snippets.action.send' }))
    await waitFor(() => expect(workbenchMocks.modalConfirm).toHaveBeenCalledTimes(1))
    await act(async () => {
      latestConfirmation().onCancel?.()
    })

    expect(workbenchMocks.sendTextToSession).not.toHaveBeenCalled()
    expect(view.props.onSnippetUsed).not.toHaveBeenCalled()
    expect(workbenchMocks.notification.success).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'snippets.action.send' }))
    await waitFor(() => expect(workbenchMocks.modalConfirm).toHaveBeenCalledTimes(2))
    await act(async () => {
      latestConfirmation().onOk?.()
    })

    await waitFor(() => {
      expect(workbenchMocks.sendTextToSession).toHaveBeenCalledWith(
        activeSession.id,
        'rm -rf /tmp/cache',
        { execute: true },
      )
      expect(view.props.onSnippetUsed).toHaveBeenCalledWith('snippet-a')
    })
    expect(workbenchMocks.notification.success).toHaveBeenCalledWith(expect.objectContaining({
      title: 'snippets.sent',
    }))
  })

  it('发送失败时不记录使用次数，也不显示发送成功', async () => {
    const user = userEvent.setup()
    workbenchMocks.sendTextToSession.mockReturnValue('not-connected')
    const view = renderWorkbench([snippet('echo test')])

    await user.click(screen.getByRole('button', { name: 'snippets.action.insert' }))

    await waitFor(() => {
      expect(workbenchMocks.notification.error).toHaveBeenCalledWith(expect.objectContaining({
        title: 'snippets.sendFailed',
      }))
    })
    expect(view.props.onSnippetUsed).not.toHaveBeenCalled()
    expect(workbenchMocks.notification.success).not.toHaveBeenCalled()
  })
})
