import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import 'antd/dist/reset.css'
import { useTranslation } from 'react-i18next'
import { AppShell } from './components/layout/AppShell'
import { HostsPage } from './features/hosts/HostsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { VaultPage } from './features/vault/VaultPage'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { useTermousData } from './app/useTermousData'
import { TerminalRuntimeProvider } from './features/terminal/TerminalRuntimeProvider'
import { createAntdTheme } from './theme/antdTheme'
import type { CredentialInput, HostInput, PageKey, ThemeMode } from './types/domain'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    if (!selectedHostId && data.hosts[0]) {
      setSelectedHostId(data.hosts[0].id)
    }
  }, [data.hosts, selectedHostId])

  const selectedHostIdStable = useMemo(() => {
    if (data.hosts.some((host) => host.id === selectedHostId)) {
      return selectedHostId
    }
    return data.hosts[0]?.id ?? ''
  }, [data.hosts, selectedHostId])

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

  return (
    <TerminalRuntimeProvider
      api={api}
      sessions={data.sessions}
      theme={theme}
      terminalSettings={data.settings.terminal}
      onSessionEvent={actions.updateSession}
    >
      <AppShell
        page={page}
        theme={theme}
        sidebarCollapsed={sidebarCollapsed}
        apiReady={apiReady}
        refreshing={refreshing}
        onNavigate={setPage}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onReload={() => void actions.reload()}
        onBeforeClose={actions.disconnectAllSessions}
        onCloseError={showActionError}
      >
        {initializing ? <div className="app-inline-status" role="status">{t('app.loading')}</div> : null}

        {page === 'workbench' ? (
          <WorkbenchPage
            data={data}
            selectedHostId={selectedHostIdStable}
            activeSession={activeSession}
            actionBusy={actionBusy}
            onSelectHost={setSelectedHostId}
            onConnect={(hostId) => runAction(() => actions.connect(hostId).then(() => undefined))}
            onOpenLocal={(shell) => runAction(() => actions.openLocalTerminal(shell).then(() => undefined))}
            onSelectSession={actions.selectSession}
            onDisconnect={(sessionId) => runAction(() => actions.disconnect(sessionId))}
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

        {page === 'settings' ? (
          <SettingsPage
            language={data.settings.language}
            terminalSettings={data.settings.terminal}
            actionBusy={actionBusy}
            onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            onTerminalSettingsChange={saveTerminalSettings}
          />
        ) : null}
      </AppShell>
    </TerminalRuntimeProvider>
  )
}

export default App
