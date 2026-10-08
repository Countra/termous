import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, ConfigProvider, Descriptions, Input, Popconfirm, Spin, Tooltip } from 'antd'
import { ArrowDown, ArrowUp, Bot, Circle, CircleAlert, Folder, LayoutDashboard, Monitor, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, ShieldCheck, Terminal, Unplug, X } from 'lucide-react'
import type { RemoteAgentQuote, RemoteBootstrap, RemoteConnection, RemoteWindowBridge, RemoteLocalTask } from '#common/contracts'
import { RemoteClient, RemoteError, unwrap, retryRemoteRead, isTransientRemoteReadError, type Inventory, type Session } from '#entities/remote-control'
import { RemoteFeedback, RemoteFeedbackStack, RemoteTransfers, remoteCopy, remoteErrorText } from '#features/remote-control'
import { formatBytes } from '#shared/format'
import { customSelectStyles, featureSidePanelStyles, FilterPopover, uiStyles } from '#shared/ui'
import styles from './RemoteWorkbench.module.scss'
import resourceStyles from './RemoteResources.module.scss'
import { RemoteSessionPanels } from './RemoteSessionPanels'
import { RemoteHostList } from './RemoteHostList'
import { RemoteOverview } from './RemoteOverview'
import { RemoteWindowControls } from './RemoteWindowControls'

const tooltipConfig = { classNames: { root: uiStyles.tooltip } }
const selectConfig = { className: customSelectStyles.select, classNames: { popup: { root: customSelectStyles['select-popup'] } } }
const tabsConfig = { classNames: { popup: { root: featureSidePanelStyles['details-tabs-dropdown'] } } }

export function RemoteWorkbench({ bridge, bootstrap, renderAgent }: { bridge: RemoteWindowBridge; bootstrap: RemoteBootstrap; renderAgent?: (client: RemoteClient, active: boolean, quote?: RemoteAgentQuote) => ReactNode }) {
  useEffect(() => {
    // 独立窗口及其浮层复用主窗口的滚动条，卸载时恢复原有标记。
    const previous = document.body.dataset.termousRemoteSurface
    document.body.dataset.termousRemoteSurface = 'true'
    return () => {
      if (previous === undefined) delete document.body.dataset.termousRemoteSurface
      else document.body.dataset.termousRemoteSurface = previous
    }
  }, [])
  const [quote, setQuote] = useState<RemoteAgentQuote>()
  const [agentSelected, setAgentSelected] = useState(false)
  const [agentOpened, setAgentOpened] = useState(false)
  const [overview, setOverview] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => { if (bootstrap.agentTarget) { setAgentOpened(true); setAgentSelected(true) } }, [bootstrap.agentTarget])
  const copy = remoteCopy(bootstrap.language)
  const [client, setClient] = useState<RemoteClient>()
  const [connection, setConnection] = useState<RemoteConnection>()
  const [inventory, setInventory] = useState<Inventory>()
  const [localTasks, setLocalTasks] = useState<RemoteLocalTask[]>([])
  const [error, setError] = useState<unknown>()
  const [connectionError, setConnectionError] = useState<unknown>()
  const [readError, setReadError] = useState<unknown>()
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [connecting, setConnecting] = useState(true)
  const reconnecting = useRef(false)
  const [filter, setFilter] = useState('')
  const [tabs, setTabs] = useState<Session[]>([])
  const [selected, setSelected] = useState('')
  const liveClient = useRef<RemoteClient | undefined>(undefined)
  const refreshAbort = useRef<AbortController | undefined>(undefined)

  const refresh = useCallback(async () => {
    const current = liveClient.current
    if (!current) return
    refreshAbort.current?.abort()
    const abort = new AbortController()
    refreshAbort.current = abort
    setRefreshing(true)
    try {
      const [result, local] = await Promise.all([
        retryRemoteRead(() => current.request({ operation: { case: 'inventory', value: {} } }), abort.signal),
        retryRemoteRead(() => current.localTransfers(), abort.signal),
      ])
      if (liveClient.current !== current || abort.signal.aborted) return
      if (result.result.case !== 'inventory') throw new RemoteError('remote_invalid')
      setLocalTasks(local)
      setReadError(undefined)
      const value = result.result.value
      setInventory(value)
      setTabs(previous => previous.map(tab => value.sessions.find(item => item.id === tab.id) ?? tab))
    } catch (reason) { if (liveClient.current === current && !abort.signal.aborted) setReadError(reason) }
    finally {
      // 同批另一项读取失败后停止后续补读；旧批次也不能覆盖较新的清单或告警。
      abort.abort()
      if (refreshAbort.current === abort) { refreshAbort.current = undefined; setRefreshing(false) }
    }
  }, [])

  useEffect(() => {
    let active = true
    let current: RemoteClient | undefined
    let timer: ReturnType<typeof setTimeout>
    let polls = 0
    const poll = async () => {
      if (!active) return
      try {
        if (!document.hidden) {
          const value = unwrap(await bridge.connection())
          if (!active) return
          setConnection(value)
          if (value.state === 'disconnected' || value.state === 'permission_expired') setClosed(true)
          if (value.state === 'connected' && ++polls % 3 === 0) await refresh()
        }
      } catch (reason) { if (active) setReadError(reason) }
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    void (async () => {
      const value = unwrap(await (attempt ? bridge.reconnect() : bridge.connection()))
      if (!active) return
      current = new RemoteClient(bridge, value)
      liveClient.current = current
      current.start(() => { if (active) setClosed(true) })
      setClient(current); setConnection(value)
      await refresh()
      if (active) timer = setTimeout(() => void poll(), 2000)
    })().catch(reason => { if (active) { setConnectionError(reason); setClosed(true) } }).finally(() => {
      if (active) { reconnecting.current = false; setConnecting(false) }
    })
    return () => { active = false; clearTimeout(timer); current?.dispose(); if (liveClient.current === current) { refreshAbort.current?.abort(); liveClient.current = undefined } }
  }, [bridge, refresh, attempt])

  const reconnect = () => {
    if (connecting || reconnecting.current) return
    reconnecting.current = true
    refreshAbort.current?.abort()
    liveClient.current?.dispose()
    liveClient.current = undefined
    setClient(undefined); setConnection(undefined); setError(undefined); setConnectionError(undefined); setReadError(undefined); setBusy(false); setClosed(false); setConnecting(true)
    setAttempt(value => value + 1)
  }

  const open = (session: Session) => {
    if (!tabs.some(tab => tab.id === session.id)) {
      if (tabs.length >= 12) { setError({ code: 'remote_capacity_exceeded' }); return }
      setTabs(previous => [...previous, session])
    }
    setAgentSelected(false)
    setOverview(false)
    setSelected(session.id)
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true)
  }
  const openAgent = () => { setAgentOpened(true); setAgentSelected(true); if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true) }
  const create = async (profileId: string, kind: 'ssh' | 'files') => {
    if (!client || liveClient.current !== client || busy || closed || connecting) return
    setBusy(true); setError(undefined)
    try {
      const result = await client.request({ operation: { case: 'createSession', value: { operationId: crypto.randomUUID(), profileId, kind, columns: 100, rows: 30 } } })
      if (liveClient.current !== client) return
      if (result.result.case === 'session') open(result.result.value)
      await refresh()
    } catch (reason) { if (liveClient.current === client) setError(reason) } finally { if (liveClient.current === client) setBusy(false) }
  }
  const disconnect = async () => {
    const current = liveClient.current
    if (!current) return
    try {
      const disconnected = unwrap(await bridge.disconnect())
      if (liveClient.current === current && disconnected) setClosed(true)
    } catch (reason) { if (liveClient.current === current) setError(reason) }
  }
  const endSession = async (session: Session) => {
    if (!client) return
    try {
      await client.request({ operation: { case: 'session', value: { action: 'close', operationId: crypto.randomUUID(), sessionId: session.id, generation: session.generation } } })
      if (liveClient.current === client) await refresh()
    } catch (reason) { if (liveClient.current === client) setError(reason) }
  }
  const name = (session: Session) => inventory?.hosts.flatMap(host => host.connections).find(profile => profile.kind === session.kind && profile.id === session.profileId)?.name || session.name || session.id
  const sessions = (inventory?.sessions ?? []).filter(item => `${name(item)} ${item.kind} ${item.engine} ${item.kind === 'ssh' ? copy.terminal : copy.files} ${inventory?.hosts.find(host => host.id === item.hostId)?.name ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const stats = connection?.stats
  const path = closed ? copy.disconnected : connection?.state === 'recovering' ? copy.recovering : stats?.path === 'relay' ? copy.relay : stats?.path === 'direct' ? copy.direct : connecting ? copy.connecting : copy.connected
  const ready = !closed && !connecting && connection?.state === 'connected'
  const readMessage = remoteErrorText(copy, readError)
  const statusClass = ready ? styles.online : closed ? styles.offline : styles.recovering
  const showOverview = () => { setOverview(true); setAgentSelected(false); if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true) }
  const details = <Descriptions size="small" column={1} items={[
    { key: 'path', label: copy.connectionPath, children: path },
    { key: 'rtt', label: copy.latency, children: ready && stats?.path ? `${Math.round(stats.rtt_ms)} ms` : '—' },
    { key: 'transport', label: copy.transport, children: stats?.path ? stats.protocol.toUpperCase() : '—' },
    { key: 'encryption', label: copy.security, children: ready ? copy.encrypted : '—' },
    { key: 'ip', label: copy.addressFamily, children: stats?.ip_version === 'ipv4' ? 'IPv4' : stats?.ip_version === 'ipv6' ? 'IPv6' : '—' },
    ...(stats?.relay_protocol ? [{ key: 'turn', label: copy.relayTransport, children: stats.relay_protocol.toUpperCase() }] : []),
  ]} />

  return <ConfigProvider tooltip={tooltipConfig} select={selectConfig} tabs={tabsConfig}><div className={styles.workbench}>
    <header className={styles.header} data-window-chrome={bridge.windowControls ? bootstrap.platform === 'darwin' ? 'macos' : 'custom' : undefined}>
      <Tooltip title={sidebarCollapsed ? copy.showSidebar : copy.hideSidebar}><Button type="text" className={styles['sidebar-toggle']}
        aria-label={sidebarCollapsed ? copy.showSidebar : copy.hideSidebar} aria-expanded={!sidebarCollapsed} aria-controls="remote-resources"
        icon={sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} onClick={() => setSidebarCollapsed(value => !value)} /></Tooltip>
      <div className={styles.identity}><span className={styles['device-icon']}><Monitor size={19} /></span><div><strong title={bootstrap.deviceName}>{bootstrap.deviceName}</strong><small>{copy.title}</small></div></div>
      <div className={styles['header-actions']}>
        <FilterPopover title={copy.details} content={<div className={styles.details}>{details}</div>}>
          <button className={styles['connection-status']} aria-label={copy.details}><span className={`${styles.dot} ${statusClass}`} /><span role="status">{path}</span>{ready && stats?.path ? <span className={styles.latency}>{Math.round(stats.rtt_ms)} ms</span> : null}</button>
        </FilterPopover>
        <span className={styles.divider} />
        <Tooltip title={copy.reconnect}><Button type="text" icon={<RefreshCw size={16} />} aria-label={copy.reconnect} loading={connecting} disabled={!closed && connection?.state !== 'recovering'} onClick={reconnect} /></Tooltip>
        <Tooltip title={copy.disconnectHint}><Button className={styles.disconnect} aria-label={copy.disconnect} icon={<Unplug size={15} />} disabled={closed || connecting} onClick={() => void disconnect()}><span className={styles['disconnect-label']}>{copy.disconnect}</span></Button></Tooltip>
      </div>
      {bridge.windowControls && bootstrap.platform !== 'darwin' ? <RemoteWindowControls bridge={bridge} onError={setError} /> : null}
    </header>
    <div className={styles.body} data-resources-visible={!sidebarCollapsed}>
      <aside id="remote-resources" className={resourceStyles.sidebar} hidden={sidebarCollapsed} aria-label={copy.resources}>
        <nav className={resourceStyles.navigation}>
          <button className={`${resourceStyles['nav-entry']} ${overview && !agentSelected ? resourceStyles.active : ''}`} aria-current={overview && !agentSelected ? 'page' : undefined} onClick={showOverview}><LayoutDashboard size={17} />{copy.overview}</button>
          {renderAgent ? <button className={`${resourceStyles['nav-entry']} ${agentSelected ? resourceStyles.active : ''}`} aria-current={agentSelected ? 'page' : undefined} disabled={!ready} onClick={openAgent}><Bot size={17} />{copy.agent}</button> : null}
        </nav>
        <Input className={resourceStyles.search} prefix={<Search size={14} />} placeholder={copy.search} aria-label={copy.search} value={filter} onChange={event => setFilter(event.target.value)} allowClear />
        <div className={resourceStyles['sidebar-scroll']}>
          <div className={resourceStyles['section-title']}><span>{copy.hosts}<small>{inventory?.hosts.length ?? 0}</small></span><Tooltip title={copy.refresh}><Button type="text" size="small" disabled={!client || closed} icon={<RefreshCw size={13} className={refreshing ? resourceStyles.refreshing : undefined} />} aria-label={copy.refresh} aria-busy={refreshing} onClick={() => void refresh()} /></Tooltip></div>
          <RemoteHostList hosts={inventory?.hosts ?? []} icons={client?.hostIcons} filter={filter} disabled={busy || !ready} copy={copy} create={(id, kind) => void create(id, kind)} />
          <div className={resourceStyles['section-title']}><span>{copy.existingSessions}<small>{sessions.length}</small></span></div>
          <div className={resourceStyles.resources}>
            {sessions.map(session => <div className={`${resourceStyles['session-row']} ${!overview && !agentSelected && selected === session.id ? resourceStyles.active : ''}`} key={session.id}>
              <button className={resourceStyles.session} disabled={!ready}
                aria-label={name(session)} aria-current={!overview && !agentSelected && selected === session.id ? 'page' : undefined}
                title={`${name(session)} · ${session.origin === 'remote' ? copy.remoteSession : copy.localSession}`} onClick={() => open(session)}>
                <span className={`${resourceStyles['resource-icon']} ${session.kind === 'files' ? resourceStyles['files-icon'] : ''}`}>{session.kind === 'ssh' ? <Terminal size={16} /> : <Folder size={16} />}</span>
                <span className={resourceStyles['session-copy']}><strong>{name(session)}</strong><small><span>{inventory?.hosts.find(host => host.id === session.hostId)?.name || (session.kind === 'ssh' ? copy.terminal : copy.files)}</span><Circle size={5} fill="currentColor" className={session.state === 'connected' ? styles.online : styles.offline} />{session.state === 'connected' ? copy.connected : copy.disconnected}</small></span>
              </button>
              <Popconfirm title={copy.closeSession} description={copy.closeSessionHint} okText={copy.confirm} cancelText={copy.cancel} onConfirm={() => endSession(session)}>
                <Tooltip title={copy.closeSession}><Button className={resourceStyles['end-session']} type="text" size="small" disabled={!ready} icon={<X size={13} />} aria-label={`${copy.closeSession} · ${name(session)}`} /></Tooltip>
              </Popconfirm>
            </div>)}
            {!sessions.length ? <p className={resourceStyles['sidebar-empty']}>{filter.trim() ? copy.noResults : copy.noSessions}</p> : null}
          </div>
        </div>
        <div className={resourceStyles['sidebar-note']}><ShieldCheck size={14} /><span>{copy.emptyHint}</span></div>
      </aside>
      <main className={styles.main} aria-label={copy.title}>
        {client && agentOpened && renderAgent && !closed ? <div className={styles['agent-surface']} hidden={!agentSelected}>{renderAgent(client, agentSelected, quote)}</div> : null}
        {agentSelected && renderAgent && !closed ? null : closed ? <div className={styles.empty}>
          <span className={styles['empty-icon']} data-failed={Boolean(connectionError)}>{connectionError ? <CircleAlert size={28} /> : <Unplug size={28} />}</span><h1>{connectionError ? copy.connectionFailed : copy.disconnected}</h1><p role={connectionError ? 'alert' : undefined}>{connectionError ? remoteErrorText(copy, connectionError) : copy.disconnectHint}</p>
          <Button type="primary" icon={<RefreshCw size={15} />} loading={connecting} onClick={reconnect}>{copy.reconnect}</Button>
        </div> : !client || connecting && !inventory ? <div className={styles.loading}><Spin size="large" /><span>{copy.connecting}</span></div> : !inventory && readError ? <div className={styles.empty}>
          <span className={styles['empty-icon']} data-failed><CircleAlert size={28} /></span><h1>{copy.resourcesFailed}</h1><p role="alert">{readMessage}</p>
          <Button type="primary" icon={<RefreshCw size={15} />} loading={refreshing} onClick={() => void refresh()}>{copy.refresh}</Button>
        </div> : !overview && tabs.length ?
          <RemoteSessionPanels onQuote={inventory?.agentEnabled && renderAgent ? (session, text) => { setQuote({ key: Date.now(), text, sessionId: session.id, capturedAt: new Date().toISOString() }); openAgent() } : undefined}
            key={connection?.id} client={client} tabs={tabs} selected={selected} inventory={inventory} localTasks={localTasks} copy={copy} theme={bootstrap.theme} name={name}
            select={setSelected} close={id => { const remaining = tabs.filter(tab => tab.id !== id); setTabs(remaining); if (id === selected) setSelected(remaining[remaining.length - 1]?.id ?? ''); if (!remaining.length) setOverview(true) }} changed={() => void refresh()} /> :
          <RemoteOverview inventory={inventory} copy={copy} deviceName={bootstrap.deviceName} filter={filter} disabled={busy || !ready} name={name} open={open}
            create={(id, kind) => void create(id, kind)} showResources={() => setSidebarCollapsed(false)} openAgent={renderAgent ? openAgent : undefined} />}
      </main>
    </div>
    <RemoteFeedbackStack inline>
      {error ? <RemoteFeedback message={remoteErrorText(copy, error)} closeLabel={copy.close} onClose={() => setError(undefined)} action={error instanceof RemoteError && error.uncertain && client && !closed ? <Button size="small" aria-label={copy.refresh} loading={refreshing} onClick={() => void refresh()}>{copy.refresh}</Button> : undefined} /> : null}
      {readError && (inventory || agentSelected) && !closed ? <RemoteFeedback message={inventory && (isTransientRemoteReadError(readError) || readMessage === copy.error) ? copy.syncUnavailable : readMessage} action={<Button size="small" aria-label={copy.refresh} loading={refreshing} onClick={() => void refresh()}>{copy.refresh}</Button>} /> : null}
    </RemoteFeedbackStack>
    {client && !closed ? <RemoteTransfers client={client} tasks={inventory?.transfers ?? []} localTasks={localTasks} operations={inventory?.operations ?? []} sessions={inventory?.sessions ?? []} copy={copy} changed={() => void refresh()} /> : null}
    <footer className={styles.footer}>
      <span><ShieldCheck size={12} />{ready ? copy.encrypted : path}</span>
      <div className={styles['footer-metrics']}>
        <span title={copy.sendRate}><ArrowUp size={12} />{ready ? `${formatBytes(stats?.send_bytes_per_second ?? 0)}/s` : '—'}</span>
        <span title={copy.receiveRate}><ArrowDown size={12} />{ready ? `${formatBytes(stats?.receive_bytes_per_second ?? 0)}/s` : '—'}</span>
        <span>{copy.sessions}<strong>{inventory?.sessions.length ?? 0}</strong></span>
      </div>
    </footer>
  </div></ConfigProvider>
}
