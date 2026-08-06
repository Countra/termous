import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { App as AntdApp, Button, Modal } from 'antd'
import { LogOut, ServerOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TermousUiProvider } from '#app/ui-runtime'
import { AppShell } from './components/layout/AppShell'
import { ConfirmDialog } from '#shared/ui'
import { HostsPage } from '#pages/hosts'
import { FilesPage } from './features/files/FilesPage'
import {
  canCommitFilesBookmarkManagementRequest,
  consumeFilesBookmarkManagementIntent,
  type FilesBookmarkManagementIntent,
  type FilesBookmarkManagementRequest,
} from './features/files/filesBookmarkManagementIntent'
import { FilesWorkspaceRuntimeProvider } from './features/files/FilesWorkspaceRuntimeProvider'
import {
  includeActiveFileSessionClosure,
  pruneRetiredFileSessionIds,
  selectActiveFileSessionAfterConnect,
  selectFileSessionCloseFallback,
  selectFileSessionForNavigation,
  selectFileSessionNavigationTarget,
} from './features/files/fileSessionRecovery'
import { ForwardingPage } from './features/forwards/ForwardingPage'
import { isForwardRestartCompleted } from './features/forwards/forwardRestart'
import { SettingsPage } from '#pages/settings'
import { snippetToInput } from '#entities/snippet'
import { SnippetsPage } from '#pages/snippets'
import { VaultPage } from '#pages/vault'
import {
  HostKeyCoordinator,
  HostLauncherModal,
  hostLauncherIntentForPage,
  type HostLauncherIntent,
} from '#features/hosts'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { TransferRuntimeProvider } from '#app/transfer-runtime'
import { useTermousData } from './app/useTermousData'
import { TerminalRuntimeProvider } from './features/terminal/TerminalRuntimeProvider'
import {
  ShortcutRuntimeProvider,
  ShortcutWindowAdapter,
} from '#app/shortcut-runtime'
import {
  UpdateRuntimeProvider,
  UpdateRuntimeSummaryReporter,
} from '#app/update-runtime'
import { readDevelopmentUpdateSimulation } from '#app/update-simulation-slot'
import { useUpdateRuntime } from '#features/update'
import { usePersistentBooleanState } from '#shared/hooks'
import { getTermousBridge } from '#shared/bridge'
import type { AppBuildInfo, CodeSnippet, CodeSnippetGroup, CodeSnippetInput, ConnectionProxy, ConnectionProxyInput, CoreFatalEvent, CredentialInput, CredentialView, ForwardEvent, GroupReorderItem, Host, HostGroup, HostIcon, HostInput, HostReachabilityEvent, Language, LocalShell, PageKey, Session, TerminalFont, ThemeMode, TrayCommand } from './types/domain'
import './App.css'
import './styles/workstation.css'
import './styles/files-workspace.css'
import './styles/files-workspace-panels.css'
import './styles/files-workspace-transfers.css'
import './styles/files-workspace-transfer-rows.css'

const APP_THEME_STORAGE_KEY = 'termous.ui.theme.v1'
const developmentUpdateSimulation = readDevelopmentUpdateSimulation()

function App() {
  const { i18n } = useTranslation()
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme)
  const language: Language = i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    } catch {
      // 本地镜像仅用于避免启动首帧闪烁，写入失败不影响后端持久化设置。
    }
  }, [theme])

  return (
    <TermousUiProvider language={language} theme={theme}>
      <UpdateRuntimeProvider
        bridge={getTermousBridge()?.updates ?? developmentUpdateSimulation?.mainBridge ?? null}
      >
        <AppContent theme={theme} setTheme={setTheme} />
      </UpdateRuntimeProvider>
    </TermousUiProvider>
  )
}

function AppContent({ theme, setTheme }: { theme: ThemeMode; setTheme: Dispatch<SetStateAction<ThemeMode>> }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { api, data, initializing, apiReady, error, activeSession, forwardErrorEvent, fileSessionClosures, actions } = useTermousData()
  const updateRuntime = useUpdateRuntime()
  const updateForwardRef = useRef(actions.updateForward)
  const reloadForwardStateRef = useRef(actions.reloadForwardsSilent)
  const updateHostReachabilityRef = useRef(actions.updateHostReachability)
  const notifiedForwardFailuresRef = useRef(new Set<string>())
  const notifiedForwardRuntimeErrorsRef = useRef(new Map<string, string>())
  const [page, setPage] = useState<PageKey>('workbench')
  const [vaultDirty, setVaultDirty] = useState(false)
  const [pendingPage, setPendingPage] = useState<PageKey | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentBooleanState('termous.ui.sidebarCollapsed.v1', false)
  const [selectedHostId, setSelectedHostId] = useState('')
  const [activeFileSessionId, setActiveFileSessionId] = useState('')
  const [filesBookmarkManagementIntent, setFilesBookmarkManagementIntent] =
    useState<FilesBookmarkManagementIntent | null>(null)
  const nextFilesBookmarkManagementIntentIdRef = useRef(0)
  const filesBookmarkManagementRequestRef =
    useRef<FilesBookmarkManagementRequest | null>(null)
  const pageRef = useRef(page)
  const sessionsRef = useRef(data.sessions)
  const [closingFileSessionIds, setClosingFileSessionIds] = useState<string[]>([])
  const closingFileSessionIdsRef = useRef(new Set<string>())
  const retiredFileSessionIdsRef = useRef(new Set<string>())
  const fileSessionsRef = useRef(data.fileSessions)
  const fileSessionClosuresRef = useRef(fileSessionClosures)
  fileSessionsRef.current = data.fileSessions
  fileSessionClosuresRef.current = fileSessionClosures
  pageRef.current = page
  sessionsRef.current = data.sessions
  const [hostLauncherState, setHostLauncherState] = useState<{
    open: boolean
    intent: HostLauncherIntent
  }>({
    open: false,
    intent: 'terminal',
  })
  const [hostCreateIntentKey, setHostCreateIntentKey] = useState(0)
  const [forwardTemporaryIntent, setForwardTemporaryIntent] = useState<{ key: number; hostId: string } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(
    developmentUpdateSimulation?.buildInfo ?? null,
  )
  const appVersion = buildInfo?.version ?? import.meta.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev'
  const [coreFatal, setCoreFatal] = useState<CoreFatalEvent | null>(null)

  const invalidateFilesBookmarkManagementRequest = useCallback(() => {
    nextFilesBookmarkManagementIntentIdRef.current += 1
    filesBookmarkManagementRequestRef.current = null
    setFilesBookmarkManagementIntent(null)
  }, [])

  const navigateToPage = useCallback((nextPage: PageKey) => {
    if (nextPage === page) {
      return
    }
    if (page === 'vault' && vaultDirty) {
      setPendingPage(nextPage)
      return
    }
    invalidateFilesBookmarkManagementRequest()
    setPage(nextPage)
  }, [invalidateFilesBookmarkManagementRequest, page, vaultDirty])

  useEffect(() => {
    if (page !== 'files') {
      invalidateFilesBookmarkManagementRequest()
    }
  }, [invalidateFilesBookmarkManagementRequest, page])

  useEffect(() => {
    if (initializing || !apiReady) {
      return
    }
    const appearanceTheme = data.settings.appearance.theme
    setTheme(appearanceTheme)
    const appearanceBridge = getTermousBridge()?.appearance
    void appearanceBridge?.setTheme(appearanceTheme).catch(() => undefined)
  }, [apiReady, data.settings.appearance.theme, initializing, setTheme])

  useEffect(() => {
    if (!selectedHostId && data.hosts[0]) {
      setSelectedHostId(data.hosts[0].id)
    }
  }, [data.hosts, selectedHostId])

  useEffect(() => {
    if (initializing && !coreFatal) {
      return
    }
    const startupBridge = getTermousBridge()?.startup
    void startupBridge?.ready()
  }, [coreFatal, initializing])

  useEffect(() => {
    const preventFileDropNavigation = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        return
      }
      // 阻止 Chromium 把拖入的本地文件当作页面导航目标。
      event.preventDefault()
    }

    window.addEventListener('dragover', preventFileDropNavigation, true)
    window.addEventListener('drop', preventFileDropNavigation, true)
    return () => {
      window.removeEventListener('dragover', preventFileDropNavigation, true)
      window.removeEventListener('drop', preventFileDropNavigation, true)
    }
  }, [])

  useEffect(() => {
    updateForwardRef.current = actions.updateForward
    reloadForwardStateRef.current = actions.reloadForwardsSilent
    updateHostReachabilityRef.current = actions.updateHostReachability
  }, [actions.reloadForwardsSilent, actions.updateForward, actions.updateHostReachability])

  useEffect(() => {
    if (!forwardErrorEvent) {
      return
    }
    notifyForwardError(forwardErrorEvent, notification, t, notifiedForwardFailuresRef, notifiedForwardRuntimeErrorsRef)
  }, [forwardErrorEvent, notification, t])

  useEffect(() => {
    if (!apiReady) {
      return undefined
    }
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const handleForwardMessage = (event: MessageEvent<string>) => {
      try {
        const forwardEvent = JSON.parse(event.data) as ForwardEvent
        updateForwardRef.current(forwardEvent)
      } catch {
        // 忽略无法解析的转发事件，避免单条异常消息中断状态同步。
      }
    }

    const connect = () => {
      socket = new WebSocket(api.forwardEventsUrl())
      socket.onopen = () => {
        void reloadForwardStateRef.current().catch(() => undefined)
      }
      socket.onmessage = handleForwardMessage
      socket.onerror = () => {
        socket?.close()
      }
      socket.onclose = () => {
        if (disposed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, 1200)
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, apiReady, notification, t])

  useEffect(() => {
    if (!apiReady) {
      return undefined
    }
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const connect = () => {
      socket = new WebSocket(api.hostReachabilityEventsUrl())
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          updateHostReachabilityRef.current(JSON.parse(event.data) as HostReachabilityEvent)
        } catch {
          // 忽略无法解析的主机在线状态事件，避免单条异常消息中断状态同步。
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onclose = () => {
        if (disposed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, 1500)
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, apiReady])

  useEffect(() => {
    let disposed = false
    const bridge = getTermousBridge()
    void bridge?.getBuildInfo?.()
      .then((info) => {
        if (!disposed && info?.version) {
          setBuildInfo(info)
        }
      })
      .catch(() => undefined)
    const coreBridge = bridge?.core
    void coreBridge?.getFatal().then((fatal) => {
      if (!disposed && fatal) {
        setCoreFatal(fatal)
      }
    })
    const cleanup = coreBridge?.onFatal((fatal) => setCoreFatal(fatal))
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    pruneRetiredFileSessionIds(
      retiredFileSessionIdsRef.current,
      data.fileSessions,
      fileSessionClosures,
    )
  }, [data.fileSessions, fileSessionClosures])

  useEffect(() => {
    if (!activeFileSessionId && data.fileSessions[0]) {
      setActiveFileSessionId(data.fileSessions[0].id)
      return
    }
    const activeClosureExists = Object.values(fileSessionClosures).some(
      (closure) => closure.session.id === activeFileSessionId,
    )
    if (
      activeFileSessionId
      && !activeClosureExists
      && !data.fileSessions.some((session) => session.id === activeFileSessionId)
    ) {
      setActiveFileSessionId(data.fileSessions[0]?.id ?? '')
    }
  }, [activeFileSessionId, data.fileSessions, fileSessionClosures])

  const selectedHostIdStable = useMemo(() => {
    if (data.hosts.some((host) => host.id === selectedHostId)) {
      return selectedHostId
    }
    return data.hosts[0]?.id ?? ''
  }, [data.hosts, selectedHostId])

  const trayRecentHosts = useMemo(
    () =>
      [...data.hosts]
        .filter((host) => Boolean(host.last_connected_at))
        .sort((left, right) => {
          return readTimestamp(right.last_connected_at) - readTimestamp(left.last_connected_at)
        })
        .slice(0, 5)
        .map((host) => ({ id: host.id, name: host.name })),
    [data.hosts],
  )
  const trayLabels = useMemo(
    () => ({
      openApp: t('tray.openApp'),
      connectHost: t('tray.connectHost'),
      recentHosts: t('tray.recentHosts'),
      emptyRecentHosts: t('tray.emptyRecentHosts'),
      forwards: t('tray.forwards'),
      updateAvailable: t('tray.updateAvailable'),
      updateDownloading: t('tray.updateDownloading'),
      updateDownloaded: t('tray.updateDownloaded'),
      quit: t('tray.quit'),
    }),
    [t],
  )

  const filesPageFileSessions = useMemo(
    () => includeActiveFileSessionClosure(
      data.fileSessions,
      fileSessionClosures,
      activeFileSessionId,
    ),
    [activeFileSessionId, data.fileSessions, fileSessionClosures],
  )
  const filesPageData = useMemo(
    () => filesPageFileSessions === data.fileSessions
      ? data
      : { ...data, fileSessions: filesPageFileSessions },
    [data, filesPageFileSessions],
  )
  const activeFileSession = useMemo(
    () => filesPageFileSessions.find((session) => session.id === activeFileSessionId)
      ?? filesPageFileSessions[0]
      ?? null,
    [activeFileSessionId, filesPageFileSessions],
  )
  const updatePreferencesRuntime = useMemo(() => {
    if (!updateRuntime.bridgeAvailable) {
      return null
    }
    return {
      generation: updateRuntime.runtimeGeneration,
      loadFailed: updateRuntime.initializationFailed,
      preferences: updateRuntime.snapshot?.preferences ?? null,
      retry: updateRuntime.retryInitialization,
      setPreferences: async (
        patch: Parameters<typeof updateRuntime.setUpdatePreferences>[0],
      ) => {
        const preferences = await updateRuntime.setUpdatePreferences(patch)
        if (!preferences) {
          throw new Error('update_bridge_unavailable')
        }
        return preferences
      },
    }
  }, [updateRuntime])

  useEffect(() => {
    if (!error) {
      setCoreFatal((current) => (current?.code === 'LOCAL_API_UNAVAILABLE' ? null : current))
      return
    }
    setCoreFatal((current) => current ?? {
      title: t('app.coreFatalTitle'),
      message: error,
      code: 'LOCAL_API_UNAVAILABLE',
    })
  }, [error, t])

  useEffect(() => {
    const trayBridge = getTermousBridge()?.tray
    void trayBridge?.updateState({
      language: data.settings.language,
      recentHosts: trayRecentHosts,
      labels: trayLabels,
    }).catch(() => undefined)
  }, [data.settings.language, trayLabels, trayRecentHosts])

  const runAction = useCallback(async <T,>(task: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setActionBusy(true)
    try {
      const result = await task()
      if (success) {
        notification.success({
          title: success,
          duration: 3,
          role: 'status',
          className: 'termous-notification',
        })
      }
      return result
    } catch (actionError) {
      notification.error({
        title: t('app.error'),
        description: actionError instanceof Error ? actionError.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
      return undefined
    } finally {
      setActionBusy(false)
    }
  }, [notification, t])

  const restartForward = useCallback(async (id: string) => {
    const restart = await runAction(() => actions.restartForward(id))
    if (!restart) {
      return
    }
    void restart.completion.then((forward) => {
      if (!isForwardRestartCompleted(forward)) {
        return
      }
      notification.success({
        title: t('forwards.restartCompleted'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    }).catch((error) => {
      console.error('等待端口转发重启终态失败', error)
    })
  }, [actions, notification, runAction, t])

  const saveHost = (id: string | null, input: HostInput): Promise<Host | undefined> =>
    runAction(async () => {
      if (id) {
        return actions.updateHost(id, input)
      }
      return actions.createHost(input)
    }, t('app.save'))

  const createHostGroup = async (name: string): Promise<HostGroup> => {
    setActionBusy(true)
    try {
      const group = await actions.createHostGroup(name)
      notification.success({
        title: t('hosts.groupCreated'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
      return group
    } catch (actionError) {
      notification.error({
        title: t('app.error'),
        description: actionError instanceof Error ? actionError.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
      throw actionError
    } finally {
      setActionBusy(false)
    }
  }

  const renameHostGroup = (id: string, name: string): Promise<HostGroup | undefined> =>
    runAction(
      () => actions.updateHostGroup(id, name),
      t('hosts.groupUpdated'),
    )

  const reorderHostGroups = (items: GroupReorderItem[]): Promise<HostGroup[] | undefined> =>
    runAction(() => actions.reorderHostGroups(items))

  const createConnectionProxy = (input: ConnectionProxyInput): Promise<ConnectionProxy | undefined> =>
    runAction(
      () => actions.createConnectionProxy(input),
      t('proxies.created'),
    )

  const updateConnectionProxy = (
    id: string,
    input: ConnectionProxyInput,
  ): Promise<ConnectionProxy | undefined> =>
    runAction(
      () => actions.updateConnectionProxy(id, input),
      t('proxies.updated'),
    )

  const saveCredential = (id: string | null, input: CredentialInput): Promise<CredentialView | undefined> =>
    runAction(async () => {
      if (id) {
        return actions.updateCredential(id, input)
      }
      return actions.createCredential(input)
    }, t('app.save'))

  const saveCodeSnippet = (id: string | null, input: CodeSnippetInput): Promise<CodeSnippet | undefined> =>
    runAction(async () => {
      if (id) {
        return actions.updateCodeSnippet(id, input)
      }
      return actions.createCodeSnippet(input)
    }, t('app.save'))

  const createCodeSnippetGroup = (name: string): Promise<CodeSnippetGroup | undefined> =>
    runAction(
      () => actions.createCodeSnippetGroup({ name }),
      t('snippets.groupCreated'),
    )

  const renameCodeSnippetGroup = (id: string, name: string): Promise<CodeSnippetGroup | undefined> =>
    runAction(
      () => actions.updateCodeSnippetGroup(id, { name }),
      t('snippets.groupUpdated'),
    )

  const reorderCodeSnippetGroups = (items: GroupReorderItem[]): Promise<CodeSnippetGroup[] | undefined> =>
    runAction(() => actions.reorderCodeSnippetGroups(items))

  const toggleCodeSnippetFavorite = (snippet: CodeSnippet) =>
    runAction(async () => {
      await actions.updateCodeSnippet(snippet.id, { ...snippetToInput(snippet), favorite: !snippet.favorite })
    })

  const showActionError = (actionError: unknown) => {
    notification.error({
      title: t('app.error'),
      description: actionError instanceof Error ? actionError.message : t('app.error'),
      duration: 5,
      role: 'alert',
      className: 'termous-notification',
    })
  }

  const saveTerminalSettings = async (terminalSettings: Parameters<typeof actions.setTerminalSettings>[0]) => {
    try {
      await actions.setTerminalSettings(terminalSettings)
    } catch (actionError) {
      showActionError(actionError)
    }
  }

  const uploadTerminalFont = async (file: File): Promise<TerminalFont> => {
    try {
      const font = await actions.uploadTerminalFont(file)
      notification.success({
        title: t('settings.fontImported'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
      return font
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const deleteTerminalFont = async (id: string) => {
    try {
      await actions.deleteTerminalFont(id)
      notification.success({
        title: t('settings.fontDeleted'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const uploadHostIcon = async (file: File): Promise<HostIcon> => {
    try {
      return await actions.uploadHostIcon(file)
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const deleteHostIcon = async (id: string) => {
    try {
      await actions.deleteHostIcon(id)
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const shutdownBeforeClose = async () => {
    const coreBridge = getTermousBridge()?.core
    if (coreBridge) {
      await coreBridge.shutdown()
      return
    }
    await actions.disconnectAllConnections()
  }

  const openFilesFromSession = async (session: Session) => {
    if (session.kind !== 'ssh' || session.status !== 'connected' || !session.host_id) {
      return
    }
    invalidateFilesBookmarkManagementRequest()
    setSelectedHostId(session.host_id)
    setPage('files')
    const existing = selectFileSessionNavigationTarget(
      data.fileSessions,
      fileSessionClosures,
      session.host_id,
      session.id,
    )
    if (existing) {
      setActiveFileSessionId(existing.id)
      return
    }
    try {
      const fileSession = await actions.connectFileSession(session.host_id, session.id)
      setActiveFileSessionId(fileSession.id)
    } catch (actionError) {
      showActionError(actionError)
    }
  }

  const saveCompletionSettings = async (
    completionSettings: Parameters<typeof actions.setCompletionSettings>[0],
  ) => {
    try {
      await actions.setCompletionSettings(completionSettings)
    } catch (actionError) {
      showActionError(actionError)
    }
  }

  const saveShortcutSettings = async (
    patch: Parameters<typeof actions.updateShortcutSettings>[0],
  ) => {
    try {
      await actions.updateShortcutSettings(patch)
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const openFileBookmarksFromSession = async (session: Session) => {
    if (session.kind !== 'ssh' || session.status !== 'connected' || !session.host_id) {
      return
    }
    nextFilesBookmarkManagementIntentIdRef.current += 1
    const request: FilesBookmarkManagementRequest = {
      requestId: nextFilesBookmarkManagementIntentIdRef.current,
      sourceSessionId: session.id,
      hostId: session.host_id,
    }
    filesBookmarkManagementRequestRef.current = request
    setFilesBookmarkManagementIntent(null)
    setSelectedHostId(session.host_id)
    pageRef.current = 'files'
    setPage('files')
    const existing = selectFileSessionNavigationTarget(
      data.fileSessions,
      fileSessionClosures,
      session.host_id,
      session.id,
    )
    try {
      const fileSession = existing
        ?? await actions.connectFileSession(session.host_id, session.id)
      if (!canCommitFilesBookmarkManagementRequest(
        request,
        filesBookmarkManagementRequestRef.current,
        pageRef.current === 'files',
        sessionsRef.current,
      )) {
        return
      }
      filesBookmarkManagementRequestRef.current = null
      setActiveFileSessionId(fileSession.id)
      setFilesBookmarkManagementIntent({
        requestId: request.requestId,
        fileSessionId: fileSession.id,
      })
    } catch (actionError) {
      if (canCommitFilesBookmarkManagementRequest(
        request,
        filesBookmarkManagementRequestRef.current,
        pageRef.current === 'files',
        sessionsRef.current,
      )) {
        filesBookmarkManagementRequestRef.current = null
        showActionError(actionError)
      }
    }
  }

  const openHostCreate = () => {
    setPage('hosts')
    setHostCreateIntentKey((current) => current + 1)
  }

  const openHostEdit = (hostId: string) => {
    setSelectedHostId(hostId)
    setPage('hosts')
  }

  const openFilesForHost = async (hostId: string) => {
    invalidateFilesBookmarkManagementRequest()
    setSelectedHostId(hostId)
    setPage('files')
    const existing = selectFileSessionForNavigation(data.fileSessions, hostId)
    if (existing) {
      setActiveFileSessionId(existing.id)
      if (
        existing.status === 'connected'
        || existing.status === 'connecting'
        || existing.status === 'waiting_trust'
      ) {
        return
      }
    }
    try {
      const fileSession = existing
        ? await actions.reconnectFileSession(existing.id)
        : await actions.connectFileSession(hostId)
      setActiveFileSessionId(fileSession.id)
    } catch (actionError) {
      showActionError(actionError)
    }
  }

  const openTemporaryForwardForHost = (hostId: string) => {
    setSelectedHostId(hostId)
    setForwardTemporaryIntent({ key: Date.now(), hostId })
    setPage('forwards')
  }

  const openHostLauncher = useCallback((intent: HostLauncherIntent) => {
    if (actionBusy) {
      return
    }
    setHostLauncherState({ open: true, intent })
  }, [actionBusy])

  const openContextualHostLauncher = useCallback(
    () => openHostLauncher(hostLauncherIntentForPage(page)),
    [openHostLauncher, page],
  )

  const openFileSessionLauncher = useCallback(
    () => openHostLauncher('files'),
    [openHostLauncher],
  )

  const openTerminalSessionLauncher = useCallback(
    () => openHostLauncher('terminal'),
    [openHostLauncher],
  )

  const closeHostLauncher = useCallback(() => {
    setHostLauncherState((current) => ({ ...current, open: false }))
  }, [])

  const connectHostFromLauncher = (hostId: string) =>
    runAction(async () => {
      await actions.connect(hostId)
      setPage('workbench')
    })

  const openLocalTerminalFromTopbar = (shell: LocalShell) => {
    if (actionBusy) {
      return
    }
    setPage('workbench')
    void runAction(() => actions.openLocalTerminal(shell).then(() => undefined))
  }

  useEffect(() => {
    const trayBridge = getTermousBridge()?.tray
    const cleanup = trayBridge?.onCommand((command) => {
      if (!isTrayCommand(command)) {
        return
      }
      if (command.type === 'open-host-launcher') {
        openHostLauncher('terminal')
        return
      }
      if (command.type === 'open-forwards') {
        setPage('forwards')
        return
      }
      if (command.type === 'connect-recent-host') {
        void runAction(async () => {
          await actions.connect(command.hostId)
          setPage('workbench')
        })
      }
    })
    return () => cleanup?.()
  }, [actions, openHostLauncher, runAction])

  return (
    <ShortcutRuntimeProvider settings={data.settings.shortcuts}>
      <ShortcutWindowAdapter handlers={{
        'app.host_launcher.open': () => {
          if (actionBusy) {
            return 'blocked'
          }
          openContextualHostLauncher()
          return 'handled'
        },
      }} />
      <FilesWorkspaceRuntimeProvider>
        <TransferRuntimeProvider api={api}>
          <UpdateRuntimeSummaryReporter
            apiReady={apiReady}
            sessions={data.sessions}
            fileSessions={data.fileSessions}
            forwards={data.forwards}
          />
          <TerminalRuntimeProvider
            api={api}
            sessions={data.sessions}
            theme={theme}
            terminalSettings={data.settings.terminal}
            completionSettings={data.settings.completion}
            terminalFonts={data.terminalFonts}
            onSessionEvent={actions.updateSession}
          >
          <AppShell
            page={page}
            appVersion={appVersion}
            windowCloseBehavior={data.settings.window.close_behavior}
            sidebarCollapsed={sidebarCollapsed}
            actionBusy={actionBusy}
            onNavigate={navigateToPage}
            onOpenConnectionLauncher={openContextualHostLauncher}
            onOpenLocalTerminal={openLocalTerminalFromTopbar}
            onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
            onBeforeClose={shutdownBeforeClose}
            onCloseError={showActionError}
          >
        <div
          className={`app-keepalive-page ${page === 'workbench' ? 'is-active' : 'is-hidden'}`}
          inert={page !== 'workbench'}
        >
          <WorkbenchPage
            api={api}
            data={data}
            fileSessionClosures={fileSessionClosures}
            theme={theme}
            active={page === 'workbench'}
            selectedHostId={selectedHostIdStable}
            activeSession={activeSession}
            actionBusy={actionBusy}
            onOpenConnectionLauncher={openTerminalSessionLauncher}
            onConnect={(hostId) => runAction(() => actions.connect(hostId).then(() => undefined))}
            onSelectSession={actions.selectSession}
            onDisconnect={async (sessionId) => (
              await runAction(async () => {
                await actions.disconnect(sessionId)
                return true
              })
            ) === true}
            onRefreshInventory={actions.refreshSessionInventory}
            onOpenFiles={openFilesFromSession}
            onManageBookmarks={openFileBookmarksFromSession}
            onConnectFileSession={actions.connectFileSession}
            onReconnectFileSession={actions.reconnectFileSession}
            onUpdateFileSession={actions.updateFileSession}
            onCreateFileBookmark={actions.createFileBookmark}
            onUpdateFileBookmark={actions.updateFileBookmark}
            onSnippetUsed={(snippetId) => runAction(
              () => actions.markCodeSnippetUsed(snippetId).then(() => undefined),
            ).then(() => undefined)}
            onToggleSnippetFavorite={toggleCodeSnippetFavorite}
            onStartForward={(input) => actions.startForward(input)}
            onRestartForward={restartForward}
            onStopForward={(id) => runAction(() => actions.stopForward(id), t('forwards.stopAccepted'))}
          />
        </div>

        {page === 'hosts' ? (
          <HostsPage
            data={data}
            selectedHostId={selectedHostIdStable}
            createIntentKey={hostCreateIntentKey}
            actionBusy={actionBusy}
            onSelectHost={setSelectedHostId}
            onSave={saveHost}
            onDelete={(id) => runAction(async () => {
              await actions.deleteHost(id)
              return true
            })}
            onCreateGroup={createHostGroup}
            onRenameGroup={renameHostGroup}
            onDeleteGroup={(id) => runAction(
              () => actions.deleteHostGroup(id),
              t('hosts.groupDeleted'),
            ).then(() => undefined)}
            onReorderGroups={reorderHostGroups}
            onCreateProxy={createConnectionProxy}
            onUpdateProxy={updateConnectionProxy}
            onDeleteProxy={(id) => runAction(async () => {
              await actions.deleteConnectionProxy(id)
              return true
            }, t('proxies.deleted'))}
            onUploadHostIcon={uploadHostIcon}
            onDeleteHostIcon={deleteHostIcon}
            getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
          />
        ) : null}

        {page === 'vault' ? (
          <VaultPage
            credentials={data.credentials}
            actionBusy={actionBusy}
            onSave={saveCredential}
            onDelete={(id) => runAction(async () => {
              await actions.deleteCredential(id)
              return true
            })}
            onDirtyChange={setVaultDirty}
          />
        ) : null}

        {page === 'files' ? (
          <FilesPage
            api={api}
            data={filesPageData}
            theme={theme}
            activeFileSession={activeFileSession}
            closingFileSessionIds={closingFileSessionIds}
            bookmarkManagementIntent={filesBookmarkManagementIntent}
            onConsumeBookmarkManagementIntent={(requestId) => {
              setFilesBookmarkManagementIntent((current) => (
                consumeFilesBookmarkManagementIntent(current, requestId)
              ))
            }}
            onOpenFileSession={openFilesForHost}
            onOpenFileSessionLauncher={openFileSessionLauncher}
            onConnectFileSession={async (
              hostId,
              sourceSessionId,
              initialPath,
              replacedFileSessionId,
            ) => {
              invalidateFilesBookmarkManagementRequest()
              const fileSession = await actions.connectFileSession(
                hostId,
                sourceSessionId,
                initialPath,
                replacedFileSessionId,
              )
              retiredFileSessionIdsRef.current.delete(fileSession.id)
              setActiveFileSessionId((current) => selectActiveFileSessionAfterConnect(
                current,
                fileSession.id,
                replacedFileSessionId,
              ))
              return fileSession
            }}
            onSelectFileSession={(fileSessionId) => {
              invalidateFilesBookmarkManagementRequest()
              setActiveFileSessionId(fileSessionId)
            }}
            onCloseFileSession={async (fileSessionId) => {
              const isClosedLocalSnapshot = !data.fileSessions.some(
                (session) => session.id === fileSessionId,
              ) && Object.values(fileSessionClosures).some(
                (closure) => closure.phase === 'closed' && closure.session.id === fileSessionId,
              )
              if (isClosedLocalSnapshot) {
                actions.supersedeFileSessionRecovery(fileSessionId)
                retiredFileSessionIdsRef.current.add(fileSessionId)
                setActiveFileSessionId((current) => {
                  if (current !== fileSessionId) {
                    return current
                  }
                  return selectFileSessionCloseFallback(
                    fileSessionsRef.current,
                    fileSessionClosuresRef.current,
                    new Set([
                      ...closingFileSessionIdsRef.current,
                      ...retiredFileSessionIdsRef.current,
                    ]),
                  )
                })
                return
              }
              if (closingFileSessionIdsRef.current.has(fileSessionId)) {
                return
              }
              closingFileSessionIdsRef.current.add(fileSessionId)
              setClosingFileSessionIds([...closingFileSessionIdsRef.current])
              try {
                await actions.closeFileSession(fileSessionId)
                retiredFileSessionIdsRef.current.add(fileSessionId)
                setActiveFileSessionId((current) => {
                  if (current !== fileSessionId) {
                    return current
                  }
                  return selectFileSessionCloseFallback(
                    fileSessionsRef.current,
                    fileSessionClosuresRef.current,
                    new Set([
                      ...closingFileSessionIdsRef.current,
                      ...retiredFileSessionIdsRef.current,
                    ]),
                  )
                })
              } catch (actionError) {
                showActionError(actionError)
              } finally {
                closingFileSessionIdsRef.current.delete(fileSessionId)
                setClosingFileSessionIds([...closingFileSessionIdsRef.current])
              }
            }}
            onReconnectFileSession={actions.reconnectFileSession}
            onUpdateFileSession={actions.updateFileSession}
            onCreateFileBookmark={actions.createFileBookmark}
            onUpdateFileBookmark={actions.updateFileBookmark}
            onDeleteFileBookmark={actions.deleteFileBookmark}
            onReorderFileBookmarks={actions.reorderFileBookmarks}
            onCreateFileBookmarkGroup={actions.createFileBookmarkGroup}
            onUpdateFileBookmarkGroup={actions.updateFileBookmarkGroup}
            onDeleteFileBookmarkGroup={actions.deleteFileBookmarkGroup}
            onReorderFileBookmarkGroups={actions.reorderFileBookmarkGroups}
            onCreateLocalPathMapping={actions.createLocalPathMapping}
            onUpdateLocalPathMapping={actions.updateLocalPathMapping}
            onDeleteLocalPathMapping={actions.deleteLocalPathMapping}
            onReorderLocalPathMappings={actions.reorderLocalPathMappings}
          />
        ) : null}

        {page === 'forwards' ? (
          <ForwardingPage
            data={data}
            actionBusy={actionBusy}
            temporaryIntent={forwardTemporaryIntent}
            onCreateProfile={(input) => actions.createForwardProfile(input)}
            onUpdateProfile={(id, input) => actions.updateForwardProfile(id, input)}
            onDeleteProfile={(id) => runAction(() => actions.deleteForwardProfile(id))}
            onStartForward={(input) => actions.startForward(input)}
            onRestartForward={restartForward}
            onStopForward={(id) => runAction(() => actions.stopForward(id), t('forwards.stopAccepted'))}
          />
        ) : null}

        {page === 'snippets' ? (
          <SnippetsPage
            data={data}
            actionBusy={actionBusy}
            onSave={saveCodeSnippet}
            onDelete={(id) => runAction(async () => {
              await actions.deleteCodeSnippet(id)
              return true
            })}
            onCreateGroup={createCodeSnippetGroup}
            onRenameGroup={renameCodeSnippetGroup}
            onDeleteGroup={(id) => runAction(
              () => actions.deleteCodeSnippetGroup(id),
              t('snippets.groupDeleted'),
            )}
            onReorderGroups={reorderCodeSnippetGroups}
          />
        ) : null}

        {page === 'settings' ? (
          <SettingsPage
            language={data.settings.language}
            appearanceSettings={data.settings.appearance}
            terminalSettings={data.settings.terminal}
            completionSettings={data.settings.completion}
            shortcutSettings={data.settings.shortcuts}
            windowSettings={data.settings.window}
            terminalFonts={data.terminalFonts}
            appVersion={appVersion}
            updatePreferencesRuntime={updatePreferencesRuntime}
            actionBusy={actionBusy}
            onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            onAppearanceSettingsChange={(appearance) => runAction(() => actions.setAppearanceSettings(appearance))}
            onTerminalSettingsChange={saveTerminalSettings}
            onCompletionSettingsChange={saveCompletionSettings}
            onShortcutSettingsChange={saveShortcutSettings}
            onWindowSettingsChange={(windowSettings) => runAction(() => actions.setWindowSettings(windowSettings))}
            onUploadTerminalFont={uploadTerminalFont}
            onDeleteTerminalFont={deleteTerminalFont}
          />
        ) : null}
          </AppShell>
      <ConfirmDialog
        open={Boolean(pendingPage)}
        title={t('vault.unsavedTitle')}
        description={t('vault.unsavedDescription')}
        confirmLabel={t('vault.discardAndContinue')}
        cancelLabel={t('app.cancel')}
        danger
        onCancel={() => setPendingPage(null)}
        onConfirm={() => {
          const nextPage = pendingPage
          setPendingPage(null)
          setVaultDirty(false)
          if (nextPage) {
            setPage(nextPage)
          }
        }}
      />
      <HostLauncherModal
        open={hostLauncherState.open}
        intent={hostLauncherState.intent}
        data={data}
        selectedHostId={selectedHostIdStable}
        actionBusy={actionBusy}
        onClose={closeHostLauncher}
        onSelectHost={setSelectedHostId}
        onConnect={connectHostFromLauncher}
        onCreateHost={openHostCreate}
        onEditHost={openHostEdit}
        onOpenFiles={openFilesForHost}
        onOpenForward={openTemporaryForwardForHost}
        onToggleFavorite={(hostId) => runAction(() => actions.toggleHostFavorite(hostId))}
        onRefreshReachability={(hostIds, force) => actions.refreshHostReachability(hostIds, force)}
        getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
      />
      <HostKeyCoordinator api={api} enabled={apiReady && !coreFatal} hosts={data.hosts} />
      <Modal
        centered
        width={420}
        open={Boolean(coreFatal)}
        title={null}
        footer={null}
        closable={false}
        closeIcon={null}
        mask={{ closable: false }}
        keyboard={false}
        className="core-fatal-modal"
        wrapClassName="confirm-modal-wrap"
        rootClassName="termous-modal-root"
        getContainer={() => document.body}
      >
        <section className="core-fatal-dialog" aria-labelledby="core-fatal-title">
          <div className="core-fatal-icon">
            <ServerOff size={22} aria-hidden="true" />
          </div>
          <div className="core-fatal-copy">
            <h2 id="core-fatal-title">{t('app.coreFatalTitle')}</h2>
          </div>
          <div className="core-fatal-actions">
            <Button
              type="primary"
              danger
              className="core-fatal-exit-button"
              icon={<LogOut size={16} aria-hidden="true" />}
              onClick={() => void getTermousBridge()?.windowControls?.confirmClose()}
            >
              {t('app.exit')}
            </Button>
          </div>
        </section>
        </Modal>
          </TerminalRuntimeProvider>
        </TransferRuntimeProvider>
      </FilesWorkspaceRuntimeProvider>
    </ShortcutRuntimeProvider>
  )
}

function readInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') {
      return stored
    }
  } catch {
    // 本地存储不可用时继续使用系统主题作为启动回退值。
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default App

function shouldNotifyForwardFailure(event: ForwardEvent) {
  return event.type === 'error' || (event.forward.status === 'failed' && event.type !== 'snapshot')
}

function shouldNotifyForwardRuntimeError(event: ForwardEvent) {
  return event.type === 'update' && event.forward.status === 'running'
}

function notifyForwardError(
  event: ForwardEvent,
  notification: ReturnType<typeof AntdApp.useApp>['notification'],
  t: (key: string, options?: Record<string, unknown>) => string,
  failedRef: React.MutableRefObject<Set<string>>,
  runtimeRef: React.MutableRefObject<Map<string, string>>,
) {
  if (event.forward.status !== 'failed') {
    failedRef.current.delete(event.forward.id)
  }
  if (event.forward.last_error) {
    const previousError = runtimeRef.current.get(event.forward.id)
    if (shouldNotifyForwardRuntimeError(event) && previousError !== event.forward.last_error) {
      runtimeRef.current.set(event.forward.id, event.forward.last_error)
      notification.error({
        title: t('forwards.runtimeError', { mode: t(`forwards.modeName.${event.forward.mode}`) }),
        description: event.forward.last_error,
        duration: 6,
        role: 'alert',
        className: 'termous-notification',
      })
      return
    }
  } else {
    runtimeRef.current.delete(event.forward.id)
  }
  if (shouldNotifyForwardFailure(event) && !failedRef.current.has(event.forward.id)) {
    failedRef.current.add(event.forward.id)
    notification.error({
      title: t('forwards.startFailed'),
      description: event.message || event.forward.last_error || event.forward.status_message || t('app.error'),
      duration: 6,
      role: 'alert',
      className: 'termous-notification',
    })
  }
}

function readTimestamp(value?: string) {
  const timestamp = new Date(value ?? '').getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isTrayCommand(command: unknown): command is TrayCommand {
  if (!command || typeof command !== 'object') {
    return false
  }
  const value = command as { type?: unknown; hostId?: unknown }
  if (value.type === 'connect-recent-host') {
    return typeof value.hostId === 'string' && value.hostId.length > 0
  }
  return value.type === 'open-app' || value.type === 'open-host-launcher' || value.type === 'open-forwards'
}
