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
      warning: vi.fn(),
    },
    initializing: false,
    apiReady: false,
    dataError: null as string | null,
    productTourProps: null as import('#features/product-tour').ProductTourControllerProps | null,
    productTourPageHarness: false,
    persistentStateSetter: vi.fn(),
    workbenchMounts: 0,
    workbenchUnmounts: 0,
    agentMounts: 0,
    agentUnmounts: 0,
    agentLaunchIntent: null as import('#entities/agent').AgentLaunchIntent | null,
    onAgentLaunchIntentHandled: null as ((key: number) => void) | null,
    onWorkbenchReferenceAgentConnection: null as import('#entities/agent').AgentConnectionReferenceProps['onReferenceAgentConnection'] | null,
    forwardErrorEvent: null as import('#entities/forward').ForwardEvent | null,
    filesPageMounts: 0,
    filesPageUnmounts: 0,
    filesAutomaticRemoteRequestsEnabled: true,
    workbenchForwardsIsArray: false,
    workbenchHostIconURL: '',
    hostAccessIntent: null as { key: number; hostId: string } | null,
    onAccessIntentHandled: null as ((key: number) => void) | null,
    onManageHostAccess: null as ((hostId: string) => void) | null,
    onCreateHost: null as (() => void) | null,
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
      hosts: [] as Array<import('#entities/host').Host>,
      hostAssets: [] as Array<Record<string, unknown>>,
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
      credentials: [] as Array<Record<string, unknown>>,
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
    onOpenProductTour,
  }: {
    children: ReactNode
    onNavigate: (page: 'workbench' | 'agent' | 'hosts' | 'vault' | 'files' | 'forwards' | 'snippets' | 'settings' | 'remote-desktop') => void
    onOpenConnectionLauncher: () => void
    onOpenProductTour: () => void
  }) => (
    <div data-provider="app-shell">
      <button
        type="button"
        data-tour={testState.productTourPageHarness ? 'topbar-connect' : undefined}
        onClick={onOpenConnectionLauncher}
      >
        global-connect
      </button>
      <button
        type="button"
        data-tour={testState.productTourPageHarness ? 'product-tour-trigger' : undefined}
        onClick={onOpenProductTour}
      >
        product-tour
      </button>
      <button type="button" onClick={() => onNavigate('workbench')}>workbench</button>
      <button type="button" onClick={() => onNavigate('agent')}>agent</button>
      <button type="button" onClick={() => onNavigate('hosts')}>hosts</button>
      <button
        type="button"
        data-tour={testState.productTourPageHarness ? 'nav-vault' : undefined}
        onClick={() => onNavigate('vault')}
      >
        vault
      </button>
      <button type="button" onClick={() => onNavigate('files')}>files</button>
      <button type="button" onClick={() => onNavigate('forwards')}>forwards</button>
      <button type="button" onClick={() => onNavigate('snippets')}>snippets</button>
      <button type="button" onClick={() => onNavigate('settings')}>settings</button>
      <button type="button" onClick={() => onNavigate('remote-desktop')}>remote-desktop</button>
      {children}
    </div>
  ),
}))

vi.mock('#pages/agent', () => ({
  AgentPage: ({
    active,
    launchIntent,
    onLaunchIntentHandled,
  }: {
    active: boolean
    launchIntent?: import('#entities/agent').AgentLaunchIntent | null
    onLaunchIntentHandled?: (key: number) => void
  }) => {
    testState.agentLaunchIntent = launchIntent ?? null
    testState.onAgentLaunchIntentHandled = onLaunchIntentHandled ?? null
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
    onReferenceAgentConnection?: import('#entities/agent').AgentConnectionReferenceProps['onReferenceAgentConnection']
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
    testState.onWorkbenchReferenceAgentConnection = props.onReferenceAgentConnection ?? null
    const [snippetUsageState, setSnippetUsageState] = useState('idle')
    useEffect(() => {
      testState.workbenchMounts += 1
      return () => {
        testState.workbenchUnmounts += 1
      }
    }, [])
    return (
      <>
        <div
          data-testid="workbench"
          data-active={String(active)}
          data-tour={testState.productTourPageHarness ? 'workbench-terminal' : undefined}
        >
          Workbench
        </div>
        <aside data-tour={testState.productTourPageHarness ? 'workbench-tools' : undefined}>
          Workbench tools
        </aside>
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
    selectedHostId,
    entryIntent,
    onEntryIntentHandled,
    onDirtyChange,
    accessIntent,
    onAccessIntentHandled,
  }: {
    data: Record<string, unknown>
    selectedHostId: string
    entryIntent?: (
      | { key: number; mode: 'catalog' | 'create' }
      | { key: number; mode: 'edit'; hostId: string }
    ) | null
    onEntryIntentHandled?: (key: number) => void
    onDirtyChange: (dirty: boolean) => void
    accessIntent?: { key: number; hostId: string } | null
    onAccessIntentHandled?: (key: number) => void
  }) => {
    const [tourView, setTourView] = useState<'catalog' | 'asset' | 'connections' | 'existing'>(() => {
      if (entryIntent?.mode === 'catalog') return 'catalog'
      if (entryIntent?.mode === 'create') return 'asset'
      return selectedHostId ? 'existing' : 'catalog'
    })
    useEffect(() => {
      if (!entryIntent) return
      setTourView(entryIntent.mode === 'catalog'
        ? 'catalog'
        : (entryIntent.mode === 'create' ? 'asset' : 'existing'))
      onEntryIntentHandled?.(entryIntent.key)
    }, [entryIntent, onEntryIntentHandled])
    testState.projectionKeys.hosts = Object.keys(data).sort()
    testState.hostAccessIntent = accessIntent ?? null
    testState.onAccessIntentHandled = onAccessIntentHandled ?? null
    if (testState.productTourPageHarness) {
      return (
        <div data-testid="hosts-page">
          {tourView === 'existing' ? (
            <div data-active-view="editor" data-testid="existing-host-editor" />
          ) : tourView === 'catalog' ? (
            <div data-active-view="catalog">
              <button type="button" data-tour="hosts-add" onClick={() => setTourView('asset')}>
                hosts-add
              </button>
            </div>
          ) : (
            <div data-active-view="editor">
              <section data-tour="host-editor">
                <button type="button" data-tour="host-back" onClick={() => setTourView('catalog')}>
                  host-back
                </button>
                <button type="button" data-tour="host-asset-tab" onClick={() => setTourView('asset')}>
                  host-asset-tab
                </button>
                <button
                  type="button"
                  data-tour="host-connections-tab"
                  onClick={() => setTourView('connections')}
                >
                  host-connections-tab
                </button>
                {tourView === 'asset' ? <div data-tour="host-asset-form" /> : null}
                {tourView === 'connections' ? <div data-tour="host-connection-catalog" /> : null}
              </section>
            </div>
          )}
        </div>
      )
    }
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
    automaticRemoteRequestsEnabled = true,
    onOpenFileSessionLauncher,
  }: {
    data: Record<string, unknown>
    automaticRemoteRequestsEnabled?: boolean
    onOpenFileSessionLauncher: () => void
  }) => {
    testState.projectionKeys.files = Object.keys(data).sort()
    testState.filesAutomaticRemoteRequestsEnabled = automaticRemoteRequestsEnabled
    useEffect(() => {
      testState.filesPageMounts += 1
      return () => {
        testState.filesPageUnmounts += 1
      }
    }, [])
    return (
      <div
        data-testid="files-page"
        data-tour={testState.productTourPageHarness ? 'files-workspace' : undefined}
      >
        Files
        <button type="button" onClick={onOpenFileSessionLauncher}>files-connect</button>
        {testState.productTourPageHarness ? (
          ['files-bookmarks', 'files-local-directory', 'files-transfers'].map((anchor) => (
            <button key={anchor} type="button" data-tour={anchor} onClick={() => void testState.action()}>
              {anchor}
            </button>
          ))
        ) : null}
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

vi.mock('#features/product-tour', () => ({
  ProductTourController: (props: import('#features/product-tour').ProductTourControllerProps) => {
    testState.productTourProps = props
    return null
  },
}))

vi.mock('../app/main/model/useRealtimeStatusSubscriptions', () => ({
  useRealtimeStatusSubscriptions: () => undefined,
}))

vi.mock('../app/main/model/useSessionSnapshotSubscription', () => ({
  useSessionSnapshotSubscription: () => undefined,
}))

vi.mock('../app/main/model/useFileSessionSnapshotSubscription', () => ({
  useFileSessionSnapshotSubscription: () => undefined,
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
    return (
      <div
        data-testid="forwards-page"
        data-tour={testState.productTourPageHarness ? 'forwards-overview' : undefined}
      >
        Forwards
      </div>
    )
  },
}))
vi.mock('#pages/settings', () => ({
  SettingsPage: ({ initialTab = 'general' }: { initialTab?: string }) => {
    const [activeTab, setActiveTab] = useState(initialTab)
    const tabs = ['general', 'terminal', 'mcp', 'agent', 'data']
    return (
      <div
        data-testid="settings-page"
        data-tour={testState.productTourPageHarness ? 'settings-workspace' : undefined}
      >
        Settings
        {testState.productTourPageHarness ? (
          <>
            <div role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                >
                  <span data-tour={`settings-${tab}-tab`}>{tab}</span>
                </button>
              ))}
            </div>
            {tabs.map((tab) => (
              <div
                key={tab}
                role="tabpanel"
                aria-hidden={activeTab !== tab}
                style={{ display: activeTab === tab ? 'block' : 'none' }}
              >
                <div data-tour={`settings-${tab}`} />
              </div>
            ))}
          </>
        ) : null}
      </div>
    )
  },
}))
vi.mock('#pages/snippets', () => ({
  SnippetsPage: ({
    data,
    onDirtyChange,
  }: {
    data: Record<string, unknown>
    onDirtyChange?: (dirty: boolean) => void
  }) => {
    testState.projectionKeys.snippets = Object.keys(data).sort()
    return (
      <div
        data-testid="snippets-page"
        data-tour={testState.productTourPageHarness ? 'snippets-workspace' : undefined}
      >
        <button type="button" onClick={() => onDirtyChange?.(true)}>snippets-dirty</button>
      </div>
    )
  },
}))
vi.mock('#pages/vault', () => ({
  VaultPage: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
    const [tourView, setTourView] = useState<'catalog' | 'editor'>('catalog')
    if (testState.productTourPageHarness) {
      return (
        <div data-testid="vault-page">
          {tourView === 'catalog' ? (
            <div data-active-view="catalog">
              <div data-tour="vault-actions">
                <button type="button" data-tour="vault-add" onClick={() => setTourView('editor')}>
                  vault-add
                </button>
              </div>
            </div>
          ) : (
            <div data-active-view="editor">
              <section data-tour="credential-editor">
                <button type="button" data-tour="credential-back" onClick={() => setTourView('catalog')}>
                  credential-back
                </button>
              </section>
            </div>
          )}
        </div>
      )
    }
    return (
      <div data-testid="vault-page">
        <button type="button" onClick={() => onDirtyChange(true)}>vault-dirty</button>
      </div>
    )
  },
}))
vi.mock('#features/hosts', () => ({
  HostLauncherModal: ({
    data,
    onManageHostAccess,
    onCreateHost,
    open,
    intent,
    onClose,
    onConnectSSHProfile,
    onOpenFileProfile,
    onOpenForward,
  }: {
    data: Record<string, unknown>
    onManageHostAccess: (hostId: string) => void
    onCreateHost: () => void
    open: boolean
    intent: string
    onClose: () => void
    onConnectSSHProfile: (profileId: string) => Promise<void>
    onOpenFileProfile: (profileId: string, hostId: string) => Promise<void>
    onOpenForward: (hostId: string, sshProfileId: string) => void
  }) => {
    testState.projectionKeys.hostLauncher = Object.keys(data).sort()
    testState.onManageHostAccess = onManageHostAccess
    testState.onCreateHost = onCreateHost
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
    initializing: testState.initializing,
    apiReady: testState.apiReady,
    error: testState.dataError,
    activeSession: null,
    forwardErrorEvent: testState.forwardErrorEvent,
    fileSessionClosures: {},
    actions: new Proxy({}, { get: () => testState.action }),
  }),
}))

import App from '#app/main'
import appStyles from '../app/main/App.module.scss'
import { prepareProductTourDom } from '../features/product-tour/model/productTourDomPreparation.ts'
import { buildProductTourSteps } from '../features/product-tour/model/productTourSteps.ts'

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
    testState.agentLaunchIntent = null
    testState.onAgentLaunchIntentHandled = null
    testState.onWorkbenchReferenceAgentConnection = null
    testState.forwardErrorEvent = null
    testState.initializing = false
    testState.apiReady = false
    testState.dataError = null
    testState.productTourProps = null
    testState.productTourPageHarness = false
    testState.filesPageMounts = 0
    testState.filesPageUnmounts = 0
    testState.filesAutomaticRemoteRequestsEnabled = true
    testState.workbenchForwardsIsArray = false
    testState.workbenchHostIconURL = ''
    testState.hostAccessIntent = null
    testState.onAccessIntentHandled = null
    testState.onManageHostAccess = null
    testState.onCreateHost = null
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
    testState.data.credentials.splice(0)
    testState.data.hostAssets.splice(0)
    testState.data.hosts.splice(0)
    Object.values(testState.projectionKeys).forEach((keys) => keys.splice(0))
    testState.action.mockReset()
    testState.action.mockResolvedValue(undefined)
    testState.notifications.error.mockReset()
    testState.notifications.success.mockReset()
    testState.notifications.warning.mockReset()
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
      'fileAccessProfiles',
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

  it('仅在 Core 就绪且凭据与主机均为空时允许自动使用向导', () => {
    const view = render(<App />)

    expect(testState.productTourProps?.ready).toBe(false)

    testState.apiReady = true
    testState.initializing = true
    view.rerender(<App />)
    expect(testState.productTourProps?.ready).toBe(false)

    testState.initializing = false
    testState.dataError = 'core unavailable'
    view.rerender(<App />)
    expect(testState.productTourProps?.ready).toBe(false)

    testState.dataError = null
    view.rerender(<App />)

    expect(testState.productTourProps).toMatchObject({
      ready: true,
      autoStartEligible: true,
      blocked: false,
      manualRequestKey: 0,
    })

    testState.data.credentials.push({ id: 'credential-a' })
    view.rerender(<App />)
    expect(testState.productTourProps?.autoStartEligible).toBe(false)

    testState.data.credentials.splice(0)
    testState.data.hostAssets.push({ id: 'host-a' })
    view.rerender(<App />)
    expect(testState.productTourProps?.autoStartEligible).toBe(false)

    testState.data.hostAssets.splice(0)
    testState.data.hosts.push({
      id: 'legacy-host-a',
      name: 'Legacy host',
      platform: 'linux',
      group_id: '',
      address: '127.0.0.1',
      port: 22,
      username: 'root',
      auth_method: 'password',
      credential_id: '',
      tags: [],
      favorite: false,
      fingerprint_policy: 'ask',
    })
    view.rerender(<App />)
    expect(testState.productTourProps?.autoStartEligible).toBe(false)
  })

  it('帮助入口递增手动请求，语义准备只导航且脏状态仅阻止跨路由', async () => {
    const user = userEvent.setup()
    testState.apiReady = true
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'product-tour' }))
    expect(testState.productTourProps?.manualRequestKey).toBe(1)
    act(() => {
      testState.productTourProps?.onPrepareStep({
        id: 'vaultNav',
        title: '',
        description: '',
        route: 'vault',
      }, new AbortController().signal)
    })
    expect(screen.getByTestId('vault-page')).toBeInTheDocument()
    expect(testState.action).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'vault-dirty' }))
    expect(testState.productTourProps?.blocked).toBe(false)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'welcome', title: '', description: '' },
      { id: 'vaultNav', title: '', description: '', route: 'vault' },
    )).toBe(false)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'vaultNav', title: '', description: '', route: 'vault' },
      { id: 'welcome', title: '', description: '' },
    )).toBe(false)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'credentialEditor', title: '', description: '', route: 'vault' },
      {
        id: 'vaultActions',
        title: '',
        description: '',
        route: 'vault',
        preparation: 'vaultCatalog',
      },
    )).toBe(true)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'credentialEditor', title: '', description: '', route: 'vault' },
      { id: 'hostsNav', title: '', description: '', route: 'hosts' },
    )).toBe(true)
    act(() => testState.productTourProps?.onBlocked())
    expect(testState.notifications.warning).toHaveBeenCalledWith(expect.objectContaining({
      title: 'productTour.menuLabel',
      description: 'productTour.blocked',
    }))
  })

  it('已有主机时向导跨页首帧直接进入目录或空白编辑器', async () => {
    testState.apiReady = true
    testState.productTourPageHarness = true
    testState.data.hostAssets.push({
      id: 'host-existing',
      name: 'Existing host',
      platform: 'linux',
      group_id: '',
      icon_id: '',
      tags: [],
      favorite: false,
      note: '',
    })
    const user = userEvent.setup()

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'hosts' }))
    expect(screen.getByTestId('existing-host-editor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workbench' }))

    await act(async () => {
      await testState.productTourProps?.onPrepareStep({
        id: 'hostsNav',
        title: '',
        description: '',
        route: 'hosts',
        preparation: 'hostCatalog',
      }, new AbortController().signal)
    })
    expect(screen.getByRole('button', { name: 'hosts-add' })).toBeInTheDocument()
    expect(screen.queryByTestId('existing-host-editor')).not.toBeInTheDocument()

    await act(async () => {
      await testState.productTourProps?.onPrepareStep({
        id: 'topbarConnect',
        title: '',
        description: '',
        route: 'workbench',
      }, new AbortController().signal)
    })
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-active', 'true')

    await act(async () => {
      await testState.productTourProps?.onPrepareStep({
        id: 'hostConnections',
        title: '',
        description: '',
        route: 'hosts',
        preparation: 'hostConnections',
      }, new AbortController().signal)
    })
    expect(document.querySelector(
      '[data-active-view="editor"] [data-tour="host-editor"]',
    )).not.toBeNull()
    expect(screen.queryByTestId('existing-host-editor')).not.toBeInTheDocument()
    expect(testState.action).not.toHaveBeenCalled()
  })

  it('普通新增主机入口继续直接进入空白编辑器', () => {
    testState.productTourPageHarness = true
    testState.data.hostAssets.push({
      id: 'host-existing',
      name: 'Existing host',
      platform: 'linux',
      group_id: '',
      icon_id: '',
      tags: [],
      favorite: false,
      note: '',
    })
    render(<App />)

    act(() => testState.onCreateHost?.())

    expect(document.querySelector(
      '[data-active-view="editor"] [data-tour="host-editor"]',
    )).not.toBeNull()
    expect(screen.queryByTestId('existing-host-editor')).not.toBeInTheDocument()
    expect(testState.action).not.toHaveBeenCalled()
  })

  it('向导切到主机目录后仍可从全局入口管理同一个已选主机', async () => {
    testState.apiReady = true
    testState.productTourPageHarness = true
    testState.data.hostAssets.push({
      id: 'host-existing',
      name: 'Existing host',
      platform: 'linux',
      group_id: '',
      icon_id: '',
      tags: [],
      favorite: false,
      note: '',
    })
    render(<App />)

    await act(async () => {
      await testState.productTourProps?.onPrepareStep({
        id: 'hostsNav',
        title: '',
        description: '',
        route: 'hosts',
        preparation: 'hostCatalog',
      }, new AbortController().signal)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'hosts-add' })).toBeInTheDocument())

    await act(async () => testState.onManageHostAccess?.('host-existing'))

    await waitFor(() => expect(screen.getByTestId('existing-host-editor')).toBeInTheDocument())
    expect(testState.hostAccessIntent).toEqual({ key: 1, hostId: 'host-existing' })
  })

  it('组合级完成二十二步页面准备且不触发写操作或连接动作', async () => {
    testState.apiReady = true
    testState.productTourPageHarness = true
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    try {
      render(<App />)
      const steps = buildProductTourSteps((key) => key)
      const preparationController = new AbortController()
      const settingsSteps = steps.filter((step) => step.preparation?.startsWith('settings'))
      const settingsPanels = new Map<string, Element>()

      const prepareStep = async (step: (typeof steps)[number]) => {
        const onPrepareStep = testState.productTourProps?.onPrepareStep
        expect(onPrepareStep).toBeTypeOf('function')
        let allowed: boolean | void | undefined
        await act(async () => {
          allowed = await onPrepareStep?.(step, preparationController.signal)
        })
        expect(allowed).toBe(true)
        let domPreparation: Promise<void> | undefined
        await act(async () => {
          domPreparation = prepareProductTourDom(step, preparationController.signal)
        })
        await domPreparation
        if (step.element) {
          await waitFor(() => expect(document.querySelector(step.element!)).not.toBeNull())
        }
      }

      for (const step of steps) {
        await prepareStep(step)
        if (settingsSteps.includes(step)) {
          settingsPanels.set(step.id, document.querySelector(step.element!)!)
        }
      }

      for (const step of [...settingsSteps].reverse()) {
        await prepareStep(step)
        expect(document.querySelector(step.element!)).toBe(settingsPanels.get(step.id))
      }

      expect(steps.map((step) => step.id)).toEqual([
        'welcome',
        'vaultNav',
        'vaultActions',
        'credentialEditor',
        'hostsNav',
        'hostEditor',
        'hostConnections',
        'topbarConnect',
        'workbench',
        'workbenchTools',
        'files',
        'filesBookmarks',
        'filesLocalDirectory',
        'filesTransfers',
        'forwards',
        'snippets',
        'settings',
        'settingsTerminal',
        'settingsMcp',
        'settingsAgent',
        'settingsData',
        'finish',
      ])
      expect(screen.getByTestId('workbench')).toHaveAttribute('data-active', 'false')
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      expect(testState.data.credentials).toHaveLength(0)
      expect(testState.data.hostAssets).toHaveLength(0)
      expect(testState.data.sessions).toHaveLength(0)
      expect(testState.launcherOpen).toBe(false)
      expect(testState.action).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('向导全部文件步骤暂停自动远程请求且不点击操作入口，结束后恢复默认行为', async () => {
    testState.apiReady = true
    testState.productTourPageHarness = true
    render(<App />)
    const filesSteps = buildProductTourSteps((key) => key).filter((step) => step.route === 'files')
    expect(filesSteps.map((step) => step.id)).toEqual([
      'files', 'filesBookmarks', 'filesLocalDirectory', 'filesTransfers',
    ])

    act(() => testState.productTourProps?.onActiveChange?.(true))
    for (const step of filesSteps) {
      const signal = new AbortController().signal
      await act(async () => {
        await testState.productTourProps?.onPrepareStep(step, signal)
      })
      await prepareProductTourDom(step, signal)
      expect(document.querySelector(step.element!)).not.toBeNull()
      expect(testState.filesAutomaticRemoteRequestsEnabled).toBe(false)
    }
    expect(screen.getByTestId('files-page')).toBeInTheDocument()
    expect(testState.filesPageMounts).toBe(1)
    expect(testState.launcherOpen).toBe(false)
    expect(testState.action).not.toHaveBeenCalled()

    act(() => testState.productTourProps?.onActiveChange?.(false))
    await waitFor(() => expect(testState.filesAutomaticRemoteRequestsEnabled).toBe(true))
  })

  it('命令片段草稿阻止向导离开独立管理页', async () => {
    const user = userEvent.setup()
    testState.apiReady = true
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'snippets' }))
    await user.click(screen.getByRole('button', { name: 'snippets-dirty' }))

    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'snippets', title: '', description: '', route: 'snippets' },
      { id: 'settings', title: '', description: '', route: 'settings' },
    )).toBe(true)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'snippets', title: '', description: '', route: 'snippets' },
      { id: 'snippets', title: '', description: '', route: 'snippets' },
    )).toBe(false)
  })

  it('主机草稿允许编辑器页签讲解，并阻止返回目录或离开页面', async () => {
    const user = userEvent.setup()
    testState.apiReady = true
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    await user.click(screen.getByRole('button', { name: 'hosts-dirty' }))

    expect(testState.productTourProps?.blocked).toBe(false)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'hostEditor', title: '', description: '', route: 'hosts' },
      {
        id: 'hostConnections',
        title: '',
        description: '',
        route: 'hosts',
        preparation: 'hostConnections',
      },
    )).toBe(false)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'hostEditor', title: '', description: '', route: 'hosts' },
      {
        id: 'hostsNav',
        title: '',
        description: '',
        route: 'hosts',
        preparation: 'hostCatalog',
      },
    )).toBe(true)
    expect(testState.productTourProps?.isTransitionBlocked?.(
      { id: 'hostConnections', title: '', description: '', route: 'hosts' },
      { id: 'topbarConnect', title: '', description: '', route: 'workbench' },
    )).toBe(true)
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
      config: { ssh_profile_id: 'ssh-a' },
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

  it('连接引用等待导航确认后才交给 Agent，取消后再次进入不执行旧引用', async () => {
    const file: import('#entities/agent').AgentFileResourceState = {
      file_access_profile_id: 'file-a', file_access_profile_name: '文件配置', host_id: 'host-a',
      host_name: '主机', ssh_profile_id: 'ssh-a', engine: 'sftp', status: 'ready',
    }
    testState.data.hostAssets.push({ id: file.host_id, name: file.host_name })
    testState.data.sshAccessProfiles.push({ id: file.ssh_profile_id, host_id: file.host_id })
    testState.data.fileAccessProfiles.push({
      id: file.file_access_profile_id,
      name: file.file_access_profile_name,
      host_id: file.host_id,
      engine: 'sftp',
      engine_config_version: 1,
      config: { ssh_profile_id: file.ssh_profile_id },
      sftp: { ssh_profile_id: file.ssh_profile_id },
      is_default: true,
      sort_order: 0,
      created_at: '2026-09-16T00:00:00Z',
      updated_at: '2026-09-16T00:00:00Z',
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    await user.click(screen.getByRole('button', { name: 'hosts-dirty' }))
    act(() => testState.onWorkbenchReferenceAgentConnection?.(file, { kind: 'new' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('hosts.unsavedTitle')
    expect(testState.agentLaunchIntent).toBeNull()
    await user.click(screen.getByRole('button', { name: 'confirm-cancel' }))

    await user.click(screen.getByRole('button', { name: 'agent' }))
    await user.click(screen.getByRole('button', { name: 'confirm-continue' }))
    expect(screen.getByTestId('agent-page')).toHaveAttribute('data-active', 'true')
    expect(testState.agentLaunchIntent).toBeNull()

    await user.click(screen.getByRole('button', { name: 'hosts' }))
    await user.click(screen.getByRole('button', { name: 'hosts-dirty' }))
    act(() => testState.onWorkbenchReferenceAgentConnection?.(file, { kind: 'new' }))
    expect(testState.agentLaunchIntent).toBeNull()
    await user.click(screen.getByRole('button', { name: 'confirm-continue' }))
    expect(testState.agentLaunchIntent).toMatchObject({ key: 2, source: 'connection_reference',
      resource_reference: { kind: 'file_profile', file_access_profile_id: file.file_access_profile_id } })
    act(() => testState.onAgentLaunchIntentHandled?.(2))
    expect(testState.agentLaunchIntent).toBeNull()
  })

  it('后台转发失败保留错误通知和去重，不提供 AI 转交操作', async () => {
    testState.forwardErrorEvent = {
      type: 'error',
      message: 'sensitive runtime detail',
      forward: {
        id: 'forward-a',
        host_id: 'host-a',
        profile_id: 'forward-profile-a',
        name: 'Production tunnel',
        mode: 'local',
        scope: 'background_profile',
        status: 'failed',
        phase: 'failed',
        progress: 100,
        bind_host: '127.0.0.1',
        bind_port: 8080,
        target_host: '127.0.0.1',
        target_port: 80,
        active_connections: 0,
        total_connections: 0,
        bytes_in: 0,
        bytes_out: 0,
        started_at: '2026-08-29T00:00:00Z',
        last_error: 'sensitive runtime detail',
      },
    }
    const view = render(<App />)

    await waitFor(() => expect(testState.notifications.error).toHaveBeenCalledOnce())
    const notification = testState.notifications.error.mock.calls[0]?.[0]
    expect(notification).toMatchObject({
      title: 'forwards.startFailed',
      description: 'sensitive runtime detail',
      duration: 6,
      role: 'alert',
    })
    expect(notification).not.toHaveProperty('actions')
    expect(testState.agentLaunchIntent).toBeNull()
    expect(screen.getByTestId('agent-page')).toHaveAttribute('data-active', 'false')

    testState.forwardErrorEvent = { ...testState.forwardErrorEvent }
    view.rerender(<App />)
    expect(testState.notifications.error).toHaveBeenCalledOnce()
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
