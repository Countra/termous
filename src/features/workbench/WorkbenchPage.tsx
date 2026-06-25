import {
  Cable,
  KeyRound,
  Layers,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Power,
  Server,
  Shell,
} from 'lucide-react'
import { Button, Tag, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ConnectionProgress } from '../terminal/ConnectionProgress'
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
  const [hostPanelCollapsed, setHostPanelCollapsed] = useState(false)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const groupedHosts = useMemo(() => groupHosts(data.hosts, data.groups), [data.hosts, data.groups])
  const sessionStatus = activeSession?.status ?? 'disconnected'
  const credential = data.credentials.find((item) => item.id === selectedHost?.credential_id)
  const jumpHost = data.hosts.find((host) => host.id === selectedHost?.jump_host_id)
  const [terminalSize, setTerminalSize] = useState({ cols: activeSession?.pty_cols ?? 120, rows: activeSession?.pty_rows ?? 32 })
  const activeTitle =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : selectedHost?.name ?? t('workbench.noHost')
  const sessionStateLabel = activeSession?.phase ? t(`connection.phase.${activeSession.phase}`) : t(`status.${sessionStatus}`)
  const targetLabel =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : selectedHost
        ? `${selectedHost.username}@${selectedHost.address}`
        : t('workbench.noHost')

  return (
    <section
      className={`page-grid workbench-grid ${hostPanelCollapsed ? 'is-host-collapsed' : ''} ${
        detailsCollapsed ? 'is-details-collapsed' : ''
      }`}
    >
      <div className={`context-panel host-context-panel ${hostPanelCollapsed ? 'is-collapsed' : ''}`}>
        <div className="panel-heading">
          <div className="panel-title-copy">
            <h2>{hostPanelCollapsed ? t('workbench.hostsShort') : t('workbench.hostPanel')}</h2>
            {!hostPanelCollapsed ? (
              <span>
                {data.hosts.length} {t('workbench.hostCount')}
              </span>
            ) : null}
          </div>
          <Tooltip title={hostPanelCollapsed ? t('app.expand') : t('app.collapse')}>
            <Button
            type="text"
            className="icon-button compact"
            onClick={() => setHostPanelCollapsed((current) => !current)}
            aria-label={hostPanelCollapsed ? t('app.expand') : t('app.collapse')}
            icon={hostPanelCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          />
          </Tooltip>
        </div>
        {data.hosts.length === 0 ? (
          <EmptyState title={t('app.empty')} description={t('workbench.terminalHint')} />
        ) : (
          <div className="host-stack">
            {Object.entries(groupedHosts).map(([group, hosts]) => (
              <div className="host-group-block" key={group}>
                {!hostPanelCollapsed ? <span className="group-label">{group || t('hosts.ungrouped')}</span> : null}
                {hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    active={host.id === selectedHost?.id}
                    collapsed={hostPanelCollapsed}
                    authLabel={t(`hosts.auth.${host.auth_method}`)}
                    onSelect={() => onSelectHost(host.id)}
                  />
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
            <Button className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('powershell')} icon={<Shell size={16} />}>
              {t('workbench.openPowerShell')}
            </Button>
            <Button className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('cmd')} icon={<Monitor size={16} />}>
              {t('workbench.openCmd')}
            </Button>
            <Button
              type="primary"
              className="primary-button"
              disabled={!selectedHost || actionBusy}
              onClick={() => selectedHost && void onConnect(selectedHost.id)}
              icon={<Cable size={16} />}
            >
              {t('app.connect')}
            </Button>
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
            <Button type="text" className="terminal-tab is-active" role="tab">
              {activeTitle}
            </Button>
            </div>
            <StatusBadge status={sessionStatus} label={t(`status.${sessionStatus}`)} />
          </div>
          <ConnectionProgress session={activeSession} />
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
            <h2>{detailsCollapsed ? t('workbench.detailsShort') : t('workbench.currentConnection')}</h2>
            {!detailsCollapsed ? <span>{t('workbench.connectionDetails')}</span> : null}
          </div>
          <Tooltip title={detailsCollapsed ? t('app.expand') : t('app.collapse')}>
            <Button
            type="text"
            className="icon-button compact"
            onClick={() => setDetailsCollapsed((current) => !current)}
            aria-label={detailsCollapsed ? t('app.expand') : t('app.collapse')}
            icon={detailsCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          />
          </Tooltip>
        </div>
        {detailsCollapsed ? (
          <div className="details-collapsed-rail">
            <Server size={18} />
            <span>{t(`status.${sessionStatus}`)}</span>
          </div>
        ) : (
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
                <dd>{sessionStateLabel}</dd>
              </div>
              <div>
                <dt>{t('workbench.jumpHost')}</dt>
                <dd>{jumpHost?.name ?? t('hosts.noJumpHost')}</dd>
              </div>
            </dl>
            <Button
              danger
              className="danger-button"
              disabled={!activeSession || actionBusy}
              onClick={() => activeSession && void onDisconnect(activeSession.id)}
              icon={<Power size={16} />}
            >
              {t('workbench.closeSession')}
            </Button>
          </>
        )}
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

function HostRow({
  host,
  active,
  collapsed,
  authLabel,
  onSelect,
}: {
  host: Host
  active: boolean
  collapsed: boolean
  authLabel: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`host-row ${active ? 'is-active' : ''} ${collapsed ? 'is-compact' : ''}`}
      onClick={onSelect}
      title={`${host.name} · ${host.username}@${host.address}:${host.port}`}
    >
      <span className="host-avatar">
        <Server size={collapsed ? 17 : 15} aria-hidden="true" />
      </span>
      {!collapsed ? (
        <>
          <span className="host-main">
            <strong>{host.name}</strong>
            <small>
              {host.username}@{host.address}:{host.port}
            </small>
          </span>
          <Tag className="host-auth" icon={<KeyRound size={12} aria-hidden="true" />}>
            {authLabel}
          </Tag>
        </>
      ) : null}
    </button>
  )
}

function groupHosts(hosts: Host[], groups: AppData['groups']) {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  return hosts.reduce<Record<string, Host[]>>((acc, host) => {
    const key = groupNames.get(host.group_id) ?? ''
    acc[key] = acc[key] ?? []
    acc[key].push(host)
    return acc
  }, {})
}
