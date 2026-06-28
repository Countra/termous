import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { App as AntdApp, ConfigProvider, Modal } from 'antd'
import 'antd/dist/reset.css'
import { useTranslation } from 'react-i18next'
import { AppShell } from './components/layout/AppShell'
import { HostsPage } from './features/hosts/HostsPage'
import { FilesPage } from './features/files/FilesPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SnippetsPage } from './features/snippets/SnippetsPage'
import { snippetToInput } from './features/snippets/snippetUtils'
import { VaultPage } from './features/vault/VaultPage'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { useTermousData } from './app/useTermousData'
import { TerminalRuntimeProvider } from './features/terminal/TerminalRuntimeProvider'
import { usePersistentBooleanState } from './hooks/usePersistentBooleanState'
import { createAntdTheme } from './theme/antdTheme'
import type { CodeSnippet, CodeSnippetInput, CoreFatalEvent, CredentialInput, HostInput, PageKey, Session, TerminalFont, ThemeMode } from './types/domain'
import './App.css'
import './styles/workstation.css'

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  )
  const antdTheme = useMemo(() => createAntdTheme(theme), [theme])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
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
  const { api, data, initializing, refreshing, apiReady, error, activeSession, actions } = useTermousData()
  const [page, setPage] = useState<PageKey>('workbench')
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentBooleanState('termous.ui.sidebarCollapsed.v1', false)
  const [selectedHostId, setSelectedHostId] = useState('')
  const [activeFileSessionId, setActiveFileSessionId] = useState('')
  const [closingFileSessionIds, setClosingFileSessionIds] = useState<string[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [appVersion, setAppVersion] = useState(import.meta.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev')
  const [coreFatal, setCoreFatal] = useState<CoreFatalEvent | null>(null)

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

  const activeFileSession = useMemo(
    () => visibleFileSessions.find((session) => session.id === activeFileSessionId) ?? visibleFileSessions[0] ?? null,
    [activeFileSessionId, visibleFileSessions],
  )

  useEffect(() => {
    if (!error) {
      notification.destroy('app-error')
      return
    }
    notification.error({
      key: 'app-error',
      title: t('app.apiOffline'),
      description: error,
      duration: 5,
      role: 'alert',
      className: 'termous-notification',
    })
  }, [error, notification, t])

  const runAction = async (task: () => Promise<void>, success?: string) => {
    setActionBusy(true)
    try {
      await task()
      if (success) {
        notification.success({
          title: success,
          duration: 3,
          role: 'status',
          className: 'termous-notification',
        })
      }
    } catch (actionError) {
      notification.error({
        title: t('app.error'),
        description: actionError instanceof Error ? actionError.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setActionBusy(false)
    }
  }

  const saveHost = (id: string | null, input: HostInput) =>
    runAction(async () => {
      if (id) {
        await actions.updateHost(id, input)
      } else {
        await actions.createHost(input)
      }
    }, t('app.save'))

  const saveCredential = (id: string | null, input: CredentialInput) =>
    runAction(async () => {
      if (id) {
        await actions.updateCredential(id, input)
      } else {
        await actions.createCredential(input)
      }
    }, t('app.save'))

  const saveCodeSnippet = (id: string | null, input: CodeSnippetInput) =>
    runAction(async () => {
      if (id) {
        await actions.updateCodeSnippet(id, input)
      } else {
        await actions.createCodeSnippet(input)
      }
    }, t('app.save'))

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

  return (
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
        theme={theme}
        appVersion={appVersion}
        sidebarCollapsed={sidebarCollapsed}
        apiReady={apiReady}
        refreshing={refreshing}
        onNavigate={setPage}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onReload={() => void actions.reload()}
        onBeforeClose={shutdownBeforeClose}
        onCloseError={showActionError}
      >
        {initializing ? <div className="app-inline-status" role="status">{t('app.loading')}</div> : null}

        {page === 'workbench' ? (
          <WorkbenchPage
            data={data}
            theme={theme}
            selectedHostId={selectedHostIdStable}
            activeSession={activeSession}
            actionBusy={actionBusy}
            onSelectHost={setSelectedHostId}
            onConnect={(hostId) => runAction(() => actions.connect(hostId).then(() => undefined))}
            onOpenLocal={(shell) => runAction(() => actions.openLocalTerminal(shell).then(() => undefined))}
            onSelectSession={actions.selectSession}
            onDisconnect={(sessionId) => runAction(() => actions.disconnect(sessionId))}
            onOpenFiles={openFilesFromSession}
            onSnippetUsed={(snippetId) => actions.markCodeSnippetUsed(snippetId).then(() => undefined)}
            onToggleSnippetFavorite={toggleCodeSnippetFavorite}
          />
        ) : null}

        {page === 'hosts' ? (
          <HostsPage
            data={data}
            selectedHostId={selectedHostIdStable}
            actionBusy={actionBusy}
            onSelectHost={setSelectedHostId}
            onSave={saveHost}
            onDelete={(id) => runAction(() => actions.deleteHost(id))}
            onImport={() => runAction(() => actions.importSSHConfig().then(() => undefined), t('hosts.importAccepted'))}
          />
        ) : null}

        {page === 'vault' ? (
          <VaultPage
            data={data}
            actionBusy={actionBusy}
            onSave={saveCredential}
            onDelete={(id) => runAction(() => actions.deleteCredential(id))}
            onGenerateKey={() => runAction(actions.generateKey)}
          />
        ) : null}

        {page === 'files' ? (
          <FilesPage
            api={api}
            data={filesPageData}
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
            onTrustFileSessionHost={actions.trustFileSessionHost}
            onUpdateFileSession={actions.updateFileSession}
          />
        ) : null}

        {page === 'snippets' ? (
          <SnippetsPage
            data={data}
            actionBusy={actionBusy}
            onSave={saveCodeSnippet}
            onDelete={(id) => runAction(() => actions.deleteCodeSnippet(id))}
          />
        ) : null}

        {page === 'settings' ? (
          <SettingsPage
            language={data.settings.language}
            terminalSettings={data.settings.terminal}
            terminalFonts={data.terminalFonts}
            appVersion={appVersion}
            actionBusy={actionBusy}
            onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            onTerminalSettingsChange={saveTerminalSettings}
            onUploadTerminalFont={uploadTerminalFont}
            onDeleteTerminalFont={deleteTerminalFont}
          />
        ) : null}
      </AppShell>
      <Modal
        centered
        open={Boolean(coreFatal)}
        title={coreFatal?.title ?? t('app.coreFatalTitle')}
        okText={t('app.exit')}
        cancelButtonProps={{ style: { display: 'none' } }}
        maskClosable={false}
        keyboard={false}
        onOk={() => void window.termous?.windowControls?.confirmClose()}
      >
        <p>{coreFatal?.message ?? t('app.coreFatalDescription')}</p>
      </Modal>
    </TerminalRuntimeProvider>
  )
}

export default App
