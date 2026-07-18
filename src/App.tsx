import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { App as AntdApp, Button, ConfigProvider, Modal } from 'antd'
import { LogOut, ServerOff } from 'lucide-react'
import 'antd/dist/reset.css'
import { useTranslation } from 'react-i18next'
import { AppShell } from './components/layout/AppShell'
import { ConfirmDialog } from './components/ui/ConfirmDialog'
import { HostsPage } from './features/hosts/HostsPage'
import { FilesPage } from './features/files/FilesPage'
import { ForwardingPage } from './features/forwards/ForwardingPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SnippetsPage } from './features/snippets/SnippetsPage'
import { snippetToInput } from './features/snippets/snippetUtils'
import { VaultPage } from './features/vault/VaultPage'
import { HostLauncherModal } from './features/workbench/HostLauncherModal'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { HostKeyCoordinator } from './components/hostkey/HostKeyCoordinator'
import { TransferRuntimeProvider } from './app/TransferRuntimeProvider'
import { useTermousData } from './app/useTermousData'
import { TerminalRuntimeProvider } from './features/terminal/TerminalRuntimeProvider'
import { usePersistentBooleanState } from './hooks/usePersistentBooleanState'
import { createAntdTheme } from './theme/antdTheme'
import type { CodeSnippet, CodeSnippetGroup, CodeSnippetInput, CoreFatalEvent, CredentialInput, CredentialView, ForwardEvent, GroupReorderItem, Host, HostGroup, HostIcon, HostInput, HostReachabilityEvent, LocalShell, PageKey, Session, TerminalFont, ThemeMode, TrayCommand } from './types/domain'
import './App.css'
import './styles/workstation.css'

const APP_THEME_STORAGE_KEY = 'termous.ui.theme.v1'

function App() {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme)
  const antdTheme = useMemo(() => createAntdTheme(theme), [theme])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    } catch {
      // 本地镜像仅用于避免启动首帧闪烁，写入失败不影响后端持久化设置。
    }
  }, [theme])

  return (
    <ConfigProvider theme={antdTheme} button={{ autoInsertSpace: false }}>
      <AntdApp
        className="termous-antd-root"
        notification={{
          placement: 'topRight',
          duration: 3,
          maxCount: 3,
          showProgress: true,
          pauseOnHover: true,
        }}
      >
        <AppContent theme={theme} setTheme={setTheme} />
      </AntdApp>
    </ConfigProvider>
  )
}

function AppContent({ theme, setTheme }: { theme: ThemeMode; setTheme: Dispatch<SetStateAction<ThemeMode>> }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { api, data, initializing, apiReady, error, activeSession, forwardErrorEvent, actions } = useTermousData()
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
  const [closingFileSessionIds, setClosingFileSessionIds] = useState<string[]>([])
  const [hostLauncherOpen, setHostLauncherOpen] = useState(false)
  const [hostCreateIntentKey, setHostCreateIntentKey] = useState(0)
  const [forwardTemporaryIntent, setForwardTemporaryIntent] = useState<{ key: number; hostId: string } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [appVersion, setAppVersion] = useState(import.meta.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev')
  const [coreFatal, setCoreFatal] = useState<CoreFatalEvent | null>(null)
  const hasActiveRuntime = useMemo(
    () =>
      data.sessions.some((session) => isSessionRuntimeActive(session.status)) ||
      data.fileSessions.some(
        (session) =>
          session.status === 'connecting' ||
          session.status === 'connected' ||
          session.status === 'waiting_trust',
      ) ||
      data.forwards.some((forward) => (
        forward.status === 'starting' ||
        forward.status === 'waiting_host_trust' ||
        forward.status === 'running' ||
        forward.status === 'stopping'
      )),
    [data.fileSessions, data.forwards, data.sessions],
  )

  const navigateToPage = useCallback((nextPage: PageKey) => {
    if (nextPage === page) {
      return
    }
    if (page === 'vault' && vaultDirty) {
      setPendingPage(nextPage)
      return
    }
    setPage(nextPage)
  }, [page, vaultDirty])

  useEffect(() => {
    if (initializing || !apiReady) {
      return
    }
    const appearanceTheme = data.settings.appearance.theme
    setTheme(appearanceTheme)
    void window.termous?.appearance?.setTheme(appearanceTheme).catch(() => undefined)
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
    void window.termous?.startup?.ready()
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
    void window.termous?.getBuildInfo?.().then((info) => {
      if (!disposed && info?.version) {
        setAppVersion(info.version)
      }
    })
    void window.termous?.core?.getFatal().then((fatal) => {
      if (!disposed && fatal) {
        setCoreFatal(fatal)
      }
    })
    const cleanup = window.termous?.core?.onFatal((fatal) => setCoreFatal(fatal))
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  const visibleFileSessions = useMemo(
    () => data.fileSessions.filter((session) => !closingFileSessionIds.includes(session.id)),
    [closingFileSessionIds, data.fileSessions],
  )
  const filesPageData = useMemo(() => ({ ...data, fileSessions: visibleFileSessions }), [data, visibleFileSessions])

  useEffect(() => {
    if (!activeFileSessionId && visibleFileSessions[0]) {
      setActiveFileSessionId(visibleFileSessions[0].id)
      return
    }
    if (activeFileSessionId && !visibleFileSessions.some((session) => session.id === activeFileSessionId)) {
      setActiveFileSessionId(visibleFileSessions[0]?.id ?? '')
    }
  }, [activeFileSessionId, visibleFileSessions])

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
      quit: t('tray.quit'),
    }),
    [t],
  )

  const activeFileSession = useMemo(
    () => visibleFileSessions.find((session) => session.id === activeFileSessionId) ?? visibleFileSessions[0] ?? null,
    [activeFileSessionId, visibleFileSessions],
  )

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
    void window.termous?.tray?.updateState({
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

  const saveCredential = (id: string | null, input: CredentialInput): Promise<CredentialView | undefined> =>
    runAction(async () => {
      if (id) {
        return actions.updateCredential(id, input)
      }
      return actions.createCredential(input)
    }, t('app.save'))

  const saveCodeSnippet = (id: string | null, input: CodeSnippetInput) =>
    runAction(async () => {
      if (id) {
        await actions.updateCodeSnippet(id, input)
      } else {
        await actions.createCodeSnippet(input)
      }
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
    if (window.termous?.core) {
      await window.termous.core.shutdown()
      return
    }
    await actions.disconnectAllConnections()
  }

  const openFilesFromSession = async (session: Session) => {
    if (session.kind !== 'ssh' || session.status !== 'connected' || !session.host_id) {
      return
    }
    setSelectedHostId(session.host_id)
    setPage('files')
    const existing = data.fileSessions.find(
      (fileSession) =>
        fileSession.source_session_id === session.id &&
        fileSession.status !== 'disconnected' &&
        fileSession.status !== 'failed',
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

  const openHostCreate = () => {
    setPage('hosts')
    setHostCreateIntentKey((current) => current + 1)
  }

  const openHostEdit = (hostId: string) => {
    setSelectedHostId(hostId)
    setPage('hosts')
  }

  const openFilesForHost = async (hostId: string) => {
    setSelectedHostId(hostId)
    setPage('files')
    const existing = data.fileSessions.find(
      (fileSession) =>
        fileSession.host_id === hostId &&
        fileSession.status !== 'disconnected' &&
        fileSession.status !== 'failed',
    )
    if (existing) {
      setActiveFileSessionId(existing.id)
      return
    }
    try {
      const fileSession = await actions.connectFileSession(hostId)
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

  const openHostLauncher = useCallback(() => {
    if (actionBusy) {
      return
    }
    setHostLauncherOpen(true)
  }, [actionBusy])

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
    const cleanup = window.termous?.tray?.onCommand((command) => {
      if (!isTrayCommand(command)) {
        return
      }
      if (command.type === 'open-host-launcher') {
        openHostLauncher()
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

  useEffect(() => {
    const handleHostLauncherShortcut = (event: KeyboardEvent) => {
      if (!isHostLauncherShortcut(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      openHostLauncher()
    }

    window.addEventListener('keydown', handleHostLauncherShortcut, true)
    return () => window.removeEventListener('keydown', handleHostLauncherShortcut, true)
  }, [openHostLauncher])

  return (
    <TransferRuntimeProvider api={api}>
      <TerminalRuntimeProvider
        api={api}
        sessions={data.sessions}
        theme={theme}
        terminalSettings={data.settings.terminal}
        terminalFonts={data.terminalFonts}
        onSessionEvent={actions.updateSession}
      >
      <AppShell
        page={page}
        appVersion={appVersion}
        windowCloseBehavior={data.settings.window.close_behavior}
        hasActiveRuntime={hasActiveRuntime}
        sidebarCollapsed={sidebarCollapsed}
        actionBusy={actionBusy}
        onNavigate={navigateToPage}
        onOpenConnectionLauncher={openHostLauncher}
        onOpenLocalTerminal={openLocalTerminalFromTopbar}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onBeforeClose={shutdownBeforeClose}
        onCloseError={showActionError}
      >
        <div
          className={`app-keepalive-page ${page === 'workbench' ? 'is-active' : 'is-hidden'}`}
          aria-hidden={page !== 'workbench'}
        >
          <WorkbenchPage
            api={api}
            data={data}
            theme={theme}
            selectedHostId={selectedHostIdStable}
            activeSession={activeSession}
            actionBusy={actionBusy}
            onConnect={(hostId) => runAction(() => actions.connect(hostId).then(() => undefined))}
            onSelectSession={actions.selectSession}
            onDisconnect={(sessionId) => runAction(() => actions.disconnect(sessionId))}
            onOpenFiles={openFilesFromSession}
            onSnippetUsed={(snippetId) => actions.markCodeSnippetUsed(snippetId).then(() => undefined)}
            onToggleSnippetFavorite={toggleCodeSnippetFavorite}
            onStartForward={(input) => actions.startForward(input)}
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
            onUploadHostIcon={uploadHostIcon}
            onDeleteHostIcon={deleteHostIcon}
            getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
          />
        ) : null}

        {page === 'vault' ? (
          <VaultPage
            data={data}
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
            selectedHostId={selectedHostIdStable}
            activeFileSession={activeFileSession}
            onSelectHost={setSelectedHostId}
            onConnectFileSession={async (hostId) => {
              const fileSession = await actions.connectFileSession(hostId)
              setActiveFileSessionId(fileSession.id)
              return fileSession
            }}
            onSelectFileSession={setActiveFileSessionId}
            onCloseFileSession={async (fileSessionId) => {
              const nextFileSessionId = visibleFileSessions.find((session) => session.id !== fileSessionId)?.id ?? ''
              setClosingFileSessionIds((current) => current.includes(fileSessionId) ? current : [...current, fileSessionId])
              if (activeFileSessionId === fileSessionId) {
                setActiveFileSessionId(nextFileSessionId)
              }
              try {
                await actions.closeFileSession(fileSessionId)
              } finally {
                setClosingFileSessionIds((current) => current.filter((id) => id !== fileSessionId))
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
            onStopForward={(id) => runAction(() => actions.stopForward(id), t('forwards.stopAccepted'))}
          />
        ) : null}

        {page === 'snippets' ? (
          <SnippetsPage
            data={data}
            actionBusy={actionBusy}
            onSave={saveCodeSnippet}
            onDelete={(id) => runAction(() => actions.deleteCodeSnippet(id))}
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
            windowSettings={data.settings.window}
            terminalFonts={data.terminalFonts}
            appVersion={appVersion}
            actionBusy={actionBusy}
            onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            onAppearanceSettingsChange={(appearance) => runAction(() => actions.setAppearanceSettings(appearance))}
            onTerminalSettingsChange={saveTerminalSettings}
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
        open={hostLauncherOpen}
        data={data}
        selectedHostId={selectedHostIdStable}
        actionBusy={actionBusy}
        onClose={() => setHostLauncherOpen(false)}
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
        width={430}
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
        <section className="core-fatal-dialog" aria-labelledby="core-fatal-title" aria-describedby="core-fatal-description">
          <div className="core-fatal-icon">
            <ServerOff size={22} aria-hidden="true" />
          </div>
          <div className="core-fatal-copy">
            <h2 id="core-fatal-title">{coreFatal?.title ?? t('app.coreFatalTitle')}</h2>
            <p id="core-fatal-description">{coreFatal?.message ?? t('app.coreFatalDescription')}</p>
          </div>
          <div className="core-fatal-actions">
            <Button
              type="primary"
              danger
              className="core-fatal-exit-button"
              icon={<LogOut size={16} aria-hidden="true" />}
              onClick={() => void window.termous?.windowControls?.confirmClose()}
            >
              {t('app.exit')}
            </Button>
          </div>
        </section>
        </Modal>
      </TerminalRuntimeProvider>
    </TransferRuntimeProvider>
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

function isHostLauncherShortcut(event: KeyboardEvent) {
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'h'
}

function readTimestamp(value?: string) {
  const timestamp = new Date(value ?? '').getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isSessionRuntimeActive(status: Session['status']) {
  return status === 'connecting' || status === 'connected' || (status as string) === 'waiting_host_trust'
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
