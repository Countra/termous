import { Cable, Layers, Monitor, PanelRightClose, PanelRightOpen, Plus, Power, Save, Shell } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { TerminalPane } from '../terminal/TerminalPane'
import type { AppData, Host, LocalShell, Session, ThemeMode } from '../../types/domain'

interface WorkbenchPageProps {
  api: TermousApi
  data: AppData
  theme: ThemeMode
  selectedHostId: string
  activeSession: Session | null
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onConnect: (hostId: string) => Promise<void>
  onOpenLocal: (shell: LocalShell) => Promise<void>
  onSessionEvent: (patch: Partial<Session>) => void
  onDisconnect: (sessionId: string) => Promise<void>
}

export function WorkbenchPage({
  api,
  data,
  theme,
  selectedHostId,
  activeSession,
  actionBusy,
  onSelectHost,
  onConnect,
  onOpenLocal,
  onSessionEvent,
  onDisconnect,
}: WorkbenchPageProps) {
  const { t } = useTranslation()
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const groupedHosts = useMemo(() => groupHosts(data.hosts), [data.hosts])
  const sessionStatus = activeSession?.status ?? 'disconnected'
  const credential = data.credentials.find((item) => item.id === selectedHost?.credential_id)
  const jumpHost = data.hosts.find((host) => host.id === selectedHost?.jump_host_id)
  const [terminalSize, setTerminalSize] = useState({ cols: activeSession?.pty_cols ?? 120, rows: activeSession?.pty_rows ?? 32 })
  const activeTitle =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : selectedHost?.name ?? t('workbench.noHost')
  const targetLabel =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : selectedHost
        ? `${selectedHost.username}@${selectedHost.address}`
        : t('workbench.noHost')

  return (
    <section className="page-grid workbench-grid">
      <div className="context-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('workbench.hostPanel')}</h2>
            <span>{data.hosts.length} {t('workbench.hostCount')}</span>
          </div>
          <button type="button" className="icon-button compact" aria-label={t('workbench.newTab')}>
            <Plus size={16} />
          </button>
        </div>
        {data.hosts.length === 0 ? (
          <EmptyState title={t('app.empty')} description={t('workbench.terminalHint')} />
        ) : (
          <div className="host-stack">
            {Object.entries(groupedHosts).map(([group, hosts]) => (
              <div className="host-group-block" key={group}>
                <span className="group-label">{group || t('hosts.ungrouped')}</span>
                {hosts.map((host) => (
                  <button
                    type="button"
                    key={host.id}
                    className={`host-row ${host.id === selectedHost?.id ? 'is-active' : ''}`}
                    onClick={() => onSelectHost(host.id)}
                  >
                    <span className="host-dot" />
                    <span>
                      <strong>{host.name}</strong>
                      <small>{host.username}@{host.address}:{host.port}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="terminal-workspace">
        <div className="page-title-row">
          <div>
            <h1>{t('workbench.title')}</h1>
            <p>{t('workbench.subtitle')}</p>
          </div>
          <div className="page-actions">
            <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('powershell')}>
              <Shell size={16} />
              {t('workbench.openPowerShell')}
            </button>
            <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('cmd')}>
              <Monitor size={16} />
              {t('workbench.openCmd')}
            </button>
            <button type="button" className="secondary-button" disabled={!selectedHost || actionBusy}>
              <Save size={16} />
              {t('workbench.saveAndConnect')}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!selectedHost || actionBusy}
              onClick={() => selectedHost && void onConnect(selectedHost.id)}
            >
              <Cable size={16} />
              {t('app.connect')}
            </button>
          </div>
        </div>

        <div className="metric-strip">
          <Metric icon={<Cable size={18} />} label={t('workbench.sessionCount')} value={String(data.sessions.length)} />
          <Metric icon={<Layers size={18} />} label={t('workbench.hostCount')} value={String(data.hosts.length)} />
          <Metric
            icon={<Power size={18} />}
            label={t('workbench.credentialState')}
            value={credential ? t('status.available') : t('status.notConfigured')}
          />
        </div>

        <div className="terminal-card">
          <div className="terminal-toolbar">
            <div className="terminal-tabs" role="tablist" aria-label={t('workbench.terminal')}>
              <button type="button" className="terminal-tab is-active" role="tab">
                {activeTitle}
              </button>
            </div>
            <StatusBadge status={sessionStatus} label={t(`status.${sessionStatus}`)} />
          </div>
          <TerminalPane
            api={api}
            session={activeSession}
            theme={theme}
            placeholder={selectedHost ? t('workbench.terminalReady') : t('workbench.terminalHint')}
            onResize={(cols, rows) => setTerminalSize({ cols, rows })}
            onSessionEvent={onSessionEvent}
          />
          <div className="terminal-statusbar">
            <span>{targetLabel}</span>
            <span>{terminalSize.cols} x {terminalSize.rows}</span>
          </div>
        </div>
      </div>

      <aside className={`details-panel ${detailsCollapsed ? 'is-collapsed' : ''}`}>
        <div className="panel-heading">
          <div>
            <h2>{t('workbench.currentConnection')}</h2>
            <span>{t('workbench.connectionDetails')}</span>
          </div>
          <button
            type="button"
            className="icon-button compact"
            onClick={() => setDetailsCollapsed((current) => !current)}
            aria-label={detailsCollapsed ? t('app.expand') : t('app.collapse')}
          >
            {detailsCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
        {!detailsCollapsed ? (
          <>
            <CustomSelect
              label={t('workbench.selectHost')}
              value={selectedHost?.id ?? ''}
              onChange={onSelectHost}
              options={data.hosts.map((host) => ({ value: host.id, label: host.name, description: host.address }))}
              disabled={data.hosts.length === 0}
            />
            <dl className="detail-list">
              <div>
                <dt>{t('hosts.address')}</dt>
                <dd>{selectedHost ? `${selectedHost.address}:${selectedHost.port}` : t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('hosts.username')}</dt>
                <dd>{selectedHost?.username ?? t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('workbench.credential')}</dt>
                <dd>{selectedHost?.auth_method === 'system' ? t('hosts.systemAuth') : credential?.name ?? t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('workbench.sessionState')}</dt>
                <dd>{activeSession?.status_message ?? t(`status.${sessionStatus}`)}</dd>
              </div>
              <div>
                <dt>{t('workbench.jumpHost')}</dt>
                <dd>{jumpHost?.name ?? t('hosts.noJumpHost')}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="danger-button"
              disabled={!activeSession || actionBusy}
              onClick={() => activeSession && void onDisconnect(activeSession.id)}
            >
              <Power size={16} />
              {t('workbench.closeSession')}
            </button>
          </>
        ) : null}
      </aside>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="metric-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function groupHosts(hosts: Host[]) {
  return hosts.reduce<Record<string, Host[]>>((acc, host) => {
    const key = host.group_id || ''
    acc[key] = acc[key] ?? []
    acc[key].push(host)
    return acc
  }, {})
}
