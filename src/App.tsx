import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import 'antd/dist/reset.css'
import { useTranslation } from 'react-i18next'
import { AppShell } from './components/layout/AppShell'
import { HostsPage } from './features/hosts/HostsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { VaultPage } from './features/vault/VaultPage'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { useTermousData } from './app/useTermousData'
import { createAntdTheme } from './theme/antdTheme'
import type { CredentialInput, HostInput, PageKey, ThemeMode } from './types/domain'
import './App.css'
import './styles/workstation.css'

function App() {
  const { t } = useTranslation()
  const { api, data, initializing, refreshing, apiReady, error, activeSession, actions } = useTermousData()
  const [page, setPage] = useState<PageKey>('workbench')
  const [theme, setTheme] = useState<ThemeMode>(() =>
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const antdTheme = useMemo(() => createAntdTheme(theme), [theme])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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

  const runAction = async (task: () => Promise<void>, success?: string) => {
    setActionBusy(true)
    setNotice(null)
    try {
      await task()
      if (success) {
        setNotice(success)
      }
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : t('app.error'))
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

  return (
    <ConfigProvider theme={antdTheme} button={{ autoInsertSpace: false }}>
      <AntdApp className="termous-antd-root">
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
        >
          {(initializing || error || notice) && (
            <div className={`app-toast ${error ? 'is-error' : ''}`} role="status">
              {initializing ? t('app.loading') : error ?? notice}
            </div>
          )}

          {page === 'workbench' ? (
            <WorkbenchPage
              api={api}
              data={data}
              theme={theme}
              selectedHostId={selectedHostIdStable}
              activeSession={activeSession}
              actionBusy={actionBusy}
              onSelectHost={setSelectedHostId}
              onConnect={(hostId) => runAction(() => actions.connect(hostId).then(() => undefined))}
              onOpenLocal={(shell) => runAction(() => actions.openLocalTerminal(shell).then(() => undefined))}
              onSelectSession={actions.selectSession}
              onSessionEvent={actions.updateSession}
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
              actionBusy={actionBusy}
              onLanguageChange={(language) => runAction(() => actions.setLanguage(language))}
            />
          ) : null}
        </AppShell>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
