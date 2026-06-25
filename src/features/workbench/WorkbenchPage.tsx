import {
  Cable,
  ChevronLeft,
  ChevronRight,
  Layers,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Power,
  Server,
  Shell,
  SquareTerminal,
} from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionProgress } from '../terminal/ConnectionProgress'
import { TerminalViewport } from '../terminal/TerminalViewport'
import type { AppData, Host, LocalShell, Session } from '../../types/domain'

interface WorkbenchPageProps {
  data: AppData
  selectedHostId: string
  activeSession: Session | null
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onConnect: (hostId: string) => Promise<void>
  onOpenLocal: (shell: LocalShell) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onDisconnect: (sessionId: string) => Promise<void>
}

export function WorkbenchPage({
  data,
  selectedHostId,
  activeSession,
  actionBusy,
  onSelectHost,
  onConnect,
  onOpenLocal,
  onSelectSession,
  onDisconnect,
}: WorkbenchPageProps) {
  const { t } = useTranslation()
  const [hostPanelCollapsed, setHostPanelCollapsed] = useState(false)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const tabViewportRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLElement>())
  const [tabScrollState, setTabScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const groupedHosts = useMemo(() => groupHosts(data.hosts, data.groups), [data.hosts, data.groups])
  const sessionStatus = activeSession?.status ?? 'disconnected'
  const hasConnectionProgress = Boolean(activeSession && activeSession.status !== 'connected' && activeSession.status !== 'disconnected')
  const credential = data.credentials.find((item) => item.id === selectedHost?.credential_id)
  const jumpHost = data.hosts.find((host) => host.id === selectedHost?.jump_host_id)
  const [terminalSize, setTerminalSize] = useState({ cols: activeSession?.pty_cols ?? 120, rows: activeSession?.pty_rows ?? 32 })
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    setTerminalSize({ cols, rows })
  }, [])
  const sessionHost = activeSession?.host_id ? data.hosts.find((host) => host.id === activeSession.host_id) : undefined
  const sessionStateLabel = activeSession?.phase ? t(`connection.phase.${activeSession.phase}`) : t(`status.${sessionStatus}`)
  const targetLabel =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : sessionHost
        ? `${sessionHost.username}@${sessionHost.address}:${sessionHost.port}`
        : t('workbench.noHost')
  const startedAt = activeSession?.started_at ? formatTime(activeSession.started_at) : t('fields.none')
  const connectedAt = activeSession?.connected_at ? formatTime(activeSession.connected_at) : t('fields.none')
  const sessionResult = activeSession?.last_error ?? (activeSession?.exit_code !== undefined ? String(activeSession.exit_code) : t('fields.none'))

  const updateTabScrollState = useCallback(() => {
    const viewport = tabViewportRef.current
    if (!viewport) {
      setTabScrollState({ canScrollLeft: false, canScrollRight: false })
      return
    }
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth
    setTabScrollState({
      canScrollLeft: viewport.scrollLeft > 1,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const viewport = tabViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({ left: direction === 'left' ? -220 : 220, behavior: 'smooth' })
    window.setTimeout(updateTabScrollState, 180)
  }, [updateTabScrollState])

  useEffect(() => {
    if (activeSession) {
      setTerminalSize({ cols: activeSession.pty_cols, rows: activeSession.pty_rows })
    }
  }, [activeSession])

  useEffect(() => {
    const viewport = tabViewportRef.current
    if (!viewport) {
      return undefined
    }
    const observer = new ResizeObserver(updateTabScrollState)
    observer.observe(viewport)
    viewport.addEventListener('scroll', updateTabScrollState, { passive: true })
    updateTabScrollState()
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateTabScrollState)
    }
  }, [data.sessions.length, updateTabScrollState])

  useEffect(() => {
    updateTabScrollState()
    const activeButton = activeSession?.id ? tabButtonRefs.current.get(activeSession.id) : undefined
    activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    window.setTimeout(updateTabScrollState, 180)
  }, [activeSession?.id, data.sessions.length, updateTabScrollState])

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
            <div className="session-tabs-shell">
              <Tooltip title={t('workbench.scrollTabsLeft')}>
                <Button
                  type="text"
                  className="session-scroll-button"
                  aria-label={t('workbench.scrollTabsLeft')}
                  disabled={!tabScrollState.canScrollLeft}
                  icon={<ChevronLeft size={15} />}
                  onClick={() => scrollTabs('left')}
                />
              </Tooltip>
              <div
                className={`terminal-tabs session-tabs ${tabScrollState.canScrollLeft ? 'has-left-overflow' : ''} ${
                  tabScrollState.canScrollRight ? 'has-right-overflow' : ''
                }`}
                role="tablist"
                aria-label={t('workbench.terminal')}
                ref={tabViewportRef}
              >
                {data.sessions.length === 0 ? (
                  <Button type="text" className="terminal-tab is-empty" role="tab" icon={<SquareTerminal size={15} />}>
                    {t('workbench.noSession')}
                  </Button>
                ) : (
                  data.sessions.map((session) => {
                    const title = sessionTitle(session, data.hosts, t)
                    return (
                      <Button
                        key={session.id}
                        ref={(node) => {
                          if (node) {
                            tabButtonRefs.current.set(session.id, node)
                          } else {
                            tabButtonRefs.current.delete(session.id)
                          }
                        }}
                        type="text"
                        className={`terminal-tab ${session.id === activeSession?.id ? 'is-active' : ''}`}
                        role="tab"
                        aria-selected={session.id === activeSession?.id}
                        onClick={() => onSelectSession(session.id)}
                        icon={<SquareTerminal size={15} />}
                      >
                        <span className={`session-dot is-${session.status}`} />
                        <span>{title}</span>
                      </Button>
                    )
                  })
                )}
              </div>
              <Tooltip title={t('workbench.scrollTabsRight')}>
                <Button
                  type="text"
                  className="session-scroll-button"
                  aria-label={t('workbench.scrollTabsRight')}
                  disabled={!tabScrollState.canScrollRight}
                  icon={<ChevronRight size={15} />}
                  onClick={() => scrollTabs('right')}
                />
              </Tooltip>
            </div>
            <StatusBadge status={sessionStatus} label={t(`status.${sessionStatus}`)} />
          </div>
          <div className={`terminal-progress-slot ${hasConnectionProgress ? 'is-active' : ''}`}>
            <ConnectionProgress session={activeSession} />
          </div>
          <TerminalViewport
            session={activeSession}
            placeholder={selectedHost ? t('workbench.terminalReady') : t('workbench.terminalHint')}
            onResize={handleTerminalResize}
          />
          <div className="terminal-statusbar">
            <StatusItem label={t('workbench.target')} value={targetLabel} />
            <StatusItem label={t('workbench.sessionState')} value={sessionStateLabel} />
            <StatusItem label={t('workbench.startedAt')} value={startedAt} />
            <StatusItem label={t('workbench.connectedAt')} value={connectedAt} />
            <StatusItem label={t('workbench.terminalSize')} value={`${terminalSize.cols} x ${terminalSize.rows}`} />
            <StatusItem label={t('workbench.result')} value={sessionResult} />
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

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="terminal-status-item">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function sessionTitle(session: Session, hosts: Host[], t: (key: string) => string) {
  if (session.kind === 'local') {
    return `${t('workbench.localTerminal')} ${shortId(session.id)}`
  }
  const host = session.host_id ? hosts.find((item) => item.id === session.host_id) : undefined
  return host?.name ?? shortId(session.id)
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  onSelect,
}: {
  host: Host
  active: boolean
  collapsed: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const authLabel = host.auth_method === 'system' ? t('hosts.systemAuth') : t(`hosts.auth.${host.auth_method}`)
  return (
    <button
      type="button"
      className={`host-row ${active ? 'is-active' : ''} ${collapsed ? 'is-compact' : ''}`}
      onClick={onSelect}
      aria-label={`${host.name} ${host.username}@${host.address}:${host.port} ${authLabel}`}
      title={`${host.name} · ${host.username}@${host.address}:${host.port} · ${authLabel}`}
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
          <AuthMethodBadge method={host.auth_method} />
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
