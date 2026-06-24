import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from './components/layout/AppShell'
import { HostsPage } from './features/hosts/HostsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { VaultPage } from './features/vault/VaultPage'
import { WorkbenchPage } from './features/workbench/WorkbenchPage'
import { useTermousData } from './app/useTermousData'
import type { CredentialInput, HostInput, PageKey, ThemeMode } from './types/domain'
import './App.css'

function App() {
  const { t } = useTranslation()
  const { api, data, loading, apiReady, error, activeSession, actions } = useTermousData()
  const [page, setPage] = useState<PageKey>('workbench')
  const [theme, setTheme] = useState<ThemeMode>(() =>
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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
    <AppShell
      page={page}
      theme={theme}
      sidebarCollapsed={sidebarCollapsed}
      apiReady={apiReady}
      onNavigate={setPage}
      onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onReload={() => void actions.reload()}
    >
      {(loading || error || notice) && (
        <div className={`app-banner ${error ? 'is-error' : ''}`}>
          {loading ? t('app.loading') : error ?? notice}
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
          onSessionEvent={actions.updateActiveSession}
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
  )
}

export default App
