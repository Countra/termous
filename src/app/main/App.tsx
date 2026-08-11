import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { App as AntdApp, Button, Modal } from 'antd'
import { LogOut, ServerOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TermousUiProvider } from '#app/ui-runtime'
import { AppShell } from '#app/app-shell'
import { ConfirmDialog, confirmDialogStyles, termousNotificationClassName } from '#shared/ui'
import { HostsPage, type HostsPageProps } from '#pages/hosts'
import {
  selectFileSessionForNavigation,
  selectFileSessionNavigationTarget,
} from '#entities/file'
import { isForwardRestartCompleted } from '#features/forwards'
import { ForwardsPage, type ForwardsPageProps } from '#pages/forwards'
import { SettingsPage } from '#pages/settings'
import { snippetToInput } from '#entities/snippet'
import { SnippetsPage, type SnippetsPageProps } from '#pages/snippets'
import { VaultPage } from '#pages/vault'
import {
  HostKeyCoordinator,
  HostLauncherModal,
  hostLauncherIntentForPage,
  type HostLauncherData,
  type HostLauncherIntent,
} from '#features/hosts'
import { WorkbenchPage, type WorkbenchPageProps } from '#widgets/workbench'
import { TransferRuntimeProvider } from '#app/transfer-runtime'
import { useTermousData } from '#app/data-runtime'
import { TerminalRuntimeProvider } from '#features/terminal'
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
import type {
  AppLanguage as Language,
  AppTheme as ThemeMode,
  CoreFatalEvent,
  TerminalFont,
  TrayCommand,
  TrayMenuState,
} from '#common/contracts'
import type { CodeSnippet, CodeSnippetGroup, CodeSnippetInput } from '#entities/snippet'
import type { ConnectionProxy, ConnectionProxyInput } from '#entities/connection-proxy'
import type { CredentialInput, CredentialView } from '#entities/credential'
import type { ForwardEvent } from '#entities/forward'
import type { Host, HostGroup, HostIcon, HostIconReorderItem, HostInput } from '#entities/host'
import type { GroupReorderItem, PageKey } from '#shared/model'
import type { LocalShell, Session } from '#entities/session'
import styles from './App.module.scss'
import {
  canCommitFilesBookmarkManagementRequest,
  consumeFilesBookmarkManagementIntent,
  FilesPage,
  type FilesBookmarkManagementIntent,
  type FilesBookmarkManagementRequest,
  type FilesPageProps,
} from '#pages/files'
import { FilesWorkspaceRuntimeProvider } from '#widgets/files-workspace'
import { useFileSessionCoordinator } from './model/useFileSessionCoordinator'
import { useRealtimeStatusSubscriptions } from './model/useRealtimeStatusSubscriptions'
import { useDesktopBridgeRuntime } from './model/useDesktopBridgeRuntime'

const APP_THEME_STORAGE_KEY = 'termous.ui.theme.v1'
const SSH_TERMINAL_SMOOTH_SCROLL_STORAGE_KEY = 'termous.ui.terminal.sshSmoothScroll.v1'
const developmentUpdateSimulation = readDevelopmentUpdateSimulation()

function App() {
  const { i18n } = useTranslation()
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme)
  const language: Language = i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US'

  useLayoutEffect(() => {
    document.body.dataset.termousMainSurface = 'true'
    return () => {
      delete document.body.dataset.termousMainSurface
    }
  }, [])

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
  const { gateways, data, initializing, apiReady, error, activeSession, forwardErrorEvent, fileSessionClosures, actions } = useTermousData()
  const hostIconSHAByID = useMemo(
    () => new Map(data.hostIcons.map((icon) => [icon.id, icon.sha256])),
    [data.hostIcons],
  )
  const getHostIconUrl = useCallback(
    (iconId: string) => gateways.hosts.hostIconFileUrl(iconId, hostIconSHAByID.get(iconId)),
    [gateways.hosts, hostIconSHAByID],
  )
  const createCredentialGateway = useCallback(
    () => Promise.resolve(gateways.credentials),
    [gateways.credentials],
  )
  const updateRuntime = useUpdateRuntime()
  const notifiedForwardFailuresRef = useRef(new Set<string>())
  const notifiedForwardRuntimeErrorsRef = useRef(new Map<string, string>())
  const showActionError = useCallback((actionError: unknown) => {
    notification.error({
      title: t('app.error'),
      description: actionError instanceof Error ? actionError.message : t('app.error'),
      duration: 5,
      role: 'alert',
      className: termousNotificationClassName,
    })
  }, [notification, t])
  const {
    displayedFileSessions,
    activeFileSession,
    closingFileSessionIds,
    activateFileSession,
    connectAndActivateFileSession,
    closeFileSession,
  } = useFileSessionCoordinator({
    fileSessions: data.fileSessions,
    fileSessionClosures,
    connectFileSession: actions.connectFileSession,
    closeFileSession: actions.closeFileSession,
    supersedeFileSessionRecovery: actions.supersedeFileSessionRecovery,
    onCloseError: showActionError,
  })
  const forwardEventsUrl = useCallback(
    () => gateways.forwards.forwardEventsUrl(),
    [gateways.forwards],
  )
  const hostReachabilityEventsUrl = useCallback(
    () => gateways.hosts.hostReachabilityEventsUrl(),
    [gateways.hosts],
  )
  useRealtimeStatusSubscriptions({
    enabled: apiReady,
    forwardEventsUrl,
    hostReachabilityEventsUrl,
    onForwardEvent: actions.updateForward,
    reloadForwards: actions.reloadForwardsSilent,
    onHostReachabilityEvent: actions.updateHostReachability,
  })
  const [page, setPage] = useState<PageKey>('workbench')
  const [vaultDirty, setVaultDirty] = useState(false)
  const [pendingPage, setPendingPage] = useState<PageKey | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentBooleanState('termous.ui.sidebarCollapsed.v1', false)
  const [sshSmoothScrollEnabled, setSshSmoothScrollEnabled] = usePersistentBooleanState(
    SSH_TERMINAL_SMOOTH_SCROLL_STORAGE_KEY,
    false,
  )
  const [selectedHostId, setSelectedHostId] = useState('')
  const [filesBookmarkManagementIntent, setFilesBookmarkManagementIntent] =
    useState<FilesBookmarkManagementIntent | null>(null)
  const nextFilesBookmarkManagementIntentIdRef = useRef(0)
  const filesBookmarkManagementRequestRef =
    useRef<FilesBookmarkManagementRequest | null>(null)
  const pageRef = useRef(page)
  const sessionsRef = useRef(data.sessions)
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
    if (!selectedHostId && data.hosts[0]) {
      setSelectedHostId(data.hosts[0].id)
    }
  }, [data.hosts, selectedHostId])

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
    if (!forwardErrorEvent) {
      return
    }
    notifyForwardError(forwardErrorEvent, notification, t, notifiedForwardFailuresRef, notifiedForwardRuntimeErrorsRef)
  }, [forwardErrorEvent, notification, t])

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
  const trayState = useMemo<TrayMenuState>(() => ({
    language: data.settings.language,
    recentHosts: trayRecentHosts,
    labels: trayLabels,
  }), [data.settings.language, trayLabels, trayRecentHosts])

  const hostManagementData = useMemo<HostsPageProps['data']>(() => ({
    hosts: data.hosts,
    groups: data.groups,
    proxies: data.proxies,
    credentials: data.credentials,
    hostIcons: data.hostIcons,
  }), [data.credentials, data.groups, data.hostIcons, data.hosts, data.proxies])
  const hostLauncherData = useMemo<HostLauncherData>(() => ({
    hosts: data.hosts,
    groups: data.groups,
    proxies: data.proxies,
    credentials: data.credentials,
    hostReachability: data.hostReachability,
  }), [data.credentials, data.groups, data.hostReachability, data.hosts, data.proxies])
  const forwardManagementData = useMemo<ForwardsPageProps['data']>(() => ({
    hosts: data.hosts,
    forwardProfiles: data.forwardProfiles,
    forwards: data.forwards,
  }), [data.forwardProfiles, data.forwards, data.hosts])
  const snippetManagementData = useMemo<SnippetsPageProps['data']>(() => ({
    snippetGroups: data.snippetGroups,
    snippets: data.snippets,
  }), [data.snippetGroups, data.snippets])
  const workbenchSessionView = useMemo<WorkbenchPageProps['sessionView']>(() => ({
    sessions: data.sessions,
    terminalSettings: data.settings.terminal,
  }), [data.sessions, data.settings.terminal])
  const workbenchFilesView = useMemo<WorkbenchPageProps['filesView']>(() => ({
    fileBookmarkGroups: data.fileBookmarkGroups,
    fileBookmarks: data.fileBookmarks,
    fileSessions: data.fileSessions,
  }), [
    data.fileBookmarkGroups,
    data.fileBookmarks,
    data.fileSessions,
  ])

  const filesPageData = useMemo<FilesPageProps['data']>(() => ({
    hosts: data.hosts,
    fileSessions: displayedFileSessions,
    fileBookmarkGroups: data.fileBookmarkGroups,
    fileBookmarks: data.fileBookmarks,
    localPathMappings: data.localPathMappings,
    settings: {
      terminal: data.settings.terminal,
    },
  }), [
    data.fileBookmarkGroups,
    data.fileBookmarks,
    data.hosts,
    data.localPathMappings,
    data.settings.terminal,
    displayedFileSessions,
  ])
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

  const runAction = useCallback(async <T,>(task: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setActionBusy(true)
    try {
      const result = await task()
      if (success) {
        notification.success({
          title: success,
          duration: 3,
          role: 'status',
          className: termousNotificationClassName,
        })
      }
      return result
    } catch (actionError) {
      notification.error({
        title: t('app.error'),
        description: actionError instanceof Error ? actionError.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: termousNotificationClassName,
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
        className: termousNotificationClassName,
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
        className: termousNotificationClassName,
      })
      return group
    } catch (actionError) {
      notification.error({
        title: t('app.error'),
        description: actionError instanceof Error ? actionError.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: termousNotificationClassName,
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
        className: termousNotificationClassName,
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
        className: termousNotificationClassName,
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

  const renameHostIcon = async (id: string, displayName: string): Promise<HostIcon> => {
    try {
      return await actions.renameHostIcon(id, displayName)
    } catch (actionError) {
      showActionError(actionError)
      throw actionError
    }
  }

  const reorderHostIcons = async (items: HostIconReorderItem[]): Promise<HostIcon[]> => {
    try {
      return await actions.reorderHostIcons(items)
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
      activateFileSession(existing.id)
      return
    }
    try {
      const fileSession = await actions.connectFileSession(session.host_id, session.id)
      activateFileSession(fileSession.id)
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
      activateFileSession(fileSession.id)
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
      activateFileSession(existing.id)
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
      activateFileSession(fileSession.id)
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

  const handleTrayCommand = useCallback((command: TrayCommand) => {
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
  }, [actions, openHostLauncher, runAction])

  const { buildInfo, nativeCoreFatal } = useDesktopBridgeRuntime({
    initialBuildInfo: developmentUpdateSimulation?.buildInfo ?? null,
    initializing,
    startupFailed: Boolean(error),
    apiReady,
    appearanceTheme: data.settings.appearance.theme,
    onThemeChange: setTheme,
    trayState,
    onTrayCommand: handleTrayCommand,
  })
  const appVersion = buildInfo?.version ?? import.meta.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev'
  const coreFatal: CoreFatalEvent | null = nativeCoreFatal ?? (error ? {
    title: t('app.coreFatalTitle'),
    message: error,
    code: 'LOCAL_API_UNAVAILABLE',
  } : null)

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
        <TransferRuntimeProvider api={gateways.transfers}>
          <UpdateRuntimeSummaryReporter
            apiReady={apiReady}
            sessions={data.sessions}
            fileSessions={data.fileSessions}
            forwards={data.forwards}
          />
          <TerminalRuntimeProvider
            api={gateways.terminal}
            sessions={data.sessions}
            theme={theme}
            terminalSettings={data.settings.terminal}
            sshSmoothScrollEnabled={sshSmoothScrollEnabled}
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
          className={`${styles['app-keepalive-page']} ${page === 'workbench' ? styles['is-active'] : styles['is-hidden']}`}
          inert={page !== 'workbench'}
        >
          <WorkbenchPage
            fileGateway={gateways.files}
            observabilityGateway={gateways.observability}
            serviceGateway={gateways.service}
            dockerGateway={gateways.docker}
            firewallGateway={gateways.firewall}
            aliasGateway={gateways.alias}
            getHostIconUrl={getHostIconUrl}
            hostView={hostLauncherData}
            sessionView={workbenchSessionView}
            filesView={workbenchFilesView}
            forwards={data.forwards}
            snippetView={snippetManagementData}
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
            data={hostManagementData}
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
            onRenameHostIcon={renameHostIcon}
            onReorderHostIcons={reorderHostIcons}
            onDeleteHostIcon={deleteHostIcon}
            getHostIconUrl={getHostIconUrl}
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
            createGateway={createCredentialGateway}
          />
        ) : null}

        {page === 'files' ? (
          <FilesPage
            fileGateway={gateways.files}
            getHostIconUrl={getHostIconUrl}
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
              const fileSession = await connectAndActivateFileSession(
                hostId,
                sourceSessionId,
                initialPath,
                replacedFileSessionId,
              )
              return fileSession
            }}
            onSelectFileSession={(fileSessionId) => {
              invalidateFilesBookmarkManagementRequest()
              activateFileSession(fileSessionId)
            }}
            onCloseFileSession={closeFileSession}
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
          <ForwardsPage
            data={forwardManagementData}
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
            data={snippetManagementData}
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
            sshSmoothScrollEnabled={sshSmoothScrollEnabled}
            completionSettings={data.settings.completion}
            shortcutSettings={data.settings.shortcuts}
            windowSettings={data.settings.window}
            terminalFonts={data.terminalFonts}
            appVersion={appVersion}
            dataPortabilityGateway={gateways.dataPortability}
            updatePreferencesRuntime={updatePreferencesRuntime}
            actionBusy={actionBusy}
            onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            onAppearanceSettingsChange={(appearance) => runAction(() => actions.setAppearanceSettings(appearance))}
            onTerminalSettingsChange={saveTerminalSettings}
            onSshSmoothScrollChange={setSshSmoothScrollEnabled}
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
        data={hostLauncherData}
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
        getHostIconUrl={getHostIconUrl}
      />
      <HostKeyCoordinator api={gateways.hostKeys} enabled={apiReady && !coreFatal} hosts={data.hosts} />
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
        className={styles['core-fatal-modal']}
        wrapClassName={`${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`}
        rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}
        getContainer={() => document.body}
      >
        <section className={styles['core-fatal-dialog']} aria-labelledby="core-fatal-title">
          <div className={styles['core-fatal-icon']}>
            <ServerOff size={22} aria-hidden="true" />
          </div>
          <div className={styles['core-fatal-copy']}>
            <h2 id="core-fatal-title">{t('app.coreFatalTitle')}</h2>
          </div>
          <div className={styles['core-fatal-actions']}>
            <Button
              type="primary"
              danger
              className={styles['core-fatal-exit-button']}
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
        className: termousNotificationClassName,
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
      className: termousNotificationClassName,
    })
  }
}

function readTimestamp(value?: string) {
  const timestamp = new Date(value ?? '').getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}
