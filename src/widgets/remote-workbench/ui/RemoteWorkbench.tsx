import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Descriptions, Empty, Input, Popconfirm, Popover, Space, Spin, Tag } from 'antd'
import { Bot, ChevronRight, Circle, Folder, Info, Monitor, RefreshCw, Search, ShieldCheck, Terminal, Unplug, X } from 'lucide-react'
import type { RemoteAgentQuote, RemoteBootstrap, RemoteConnection, RemoteWindowBridge, RemoteLocalTask } from '#common/contracts'
import { RemoteClient, RemoteError, unwrap, retryRemoteRead, isTransientRemoteReadError, type Inventory, type Session } from '#entities/remote-control'
import { RemoteTransfers, remoteCopy, remoteErrorText } from '#features/remote-control'
import styles from './RemoteWorkbench.module.scss'
import { RemoteSessionPanels } from './RemoteSessionPanels'
import { RemoteHostList } from './RemoteHostList'

export function RemoteWorkbench({ bridge, bootstrap, renderAgent }: { bridge: RemoteWindowBridge; bootstrap: RemoteBootstrap; renderAgent?: (client: RemoteClient, active: boolean, quote?: RemoteAgentQuote) => ReactNode }) {
  const [quote, setQuote] = useState<RemoteAgentQuote>()
  const [agentSelected, setAgentSelected] = useState(false)
  const [agentOpened, setAgentOpened] = useState(false)
  useEffect(() => { if (bootstrap.agentTarget) { setAgentOpened(true); setAgentSelected(true) } }, [bootstrap.agentTarget])
  const copy = remoteCopy(bootstrap.language)
  const [client, setClient] = useState<RemoteClient>()
  const [connection, setConnection] = useState<RemoteConnection>()
  const [inventory, setInventory] = useState<Inventory>()
  const [localTasks, setLocalTasks] = useState<RemoteLocalTask[]>([])
  const [error, setError] = useState<unknown>()
  const [readError, setReadError] = useState<unknown>()
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)
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
      if (refreshAbort.current === abort) refreshAbort.current = undefined
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
    })().catch(reason => { if (active) { setError(reason); setClosed(true) } }).finally(() => {
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
    setClient(undefined); setConnection(undefined); setError(undefined); setReadError(undefined); setClosed(false); setConnecting(true)
    setAttempt(value => value + 1)
  }

  const open = (session: Session) => {
    if (!tabs.some(tab => tab.id === session.id)) {
      if (tabs.length >= 12) { setError({ code: 'remote_capacity_exceeded' }); return }
      setTabs(previous => [...previous, session])
    }
    setAgentSelected(false)
    setSelected(session.id)
  }
  const openAgent = () => { setAgentOpened(true); setAgentSelected(true) }
  const create = async (profileId: string, kind: 'ssh' | 'files') => {
    if (!client || busy || closed) return
    setBusy(true); setError(undefined)
    try {
      const result = await client.request({ operation: { case: 'createSession', value: { operationId: crypto.randomUUID(), profileId, kind, columns: 100, rows: 30 } } })
      if (liveClient.current !== client) return
      if (result.result.case === 'session') open(result.result.value)
      await refresh()
    } catch (reason) { if (liveClient.current === client) setError(reason) } finally { setBusy(false) }
  }
  const endSession = async (session: Session) => {
    if (!client) return
    try {
      await client.request({ operation: { case: 'session', value: { action: 'close', operationId: crypto.randomUUID(), sessionId: session.id, generation: session.generation } } })
      if (liveClient.current === client) await refresh()
    } catch (reason) { if (liveClient.current === client) setError(reason) }
  }
  const name = (session: Session) => inventory?.hosts.flatMap(host => host.connections).find(profile => profile.kind === session.kind && profile.id === session.profileId)?.name || session.name || session.id
  const sessions = (inventory?.sessions ?? []).filter(item => `${name(item)} ${item.kind}`.toLowerCase().includes(filter.toLowerCase()))
  const stats = connection?.stats
  const path = closed ? copy.disconnected : connection?.state === 'recovering' ? copy.recovering : stats?.path === 'relay' ? copy.relay : stats?.path === 'direct' ? `${copy.direct} · ${stats.protocol.toUpperCase()}` : copy.connecting

  return <div className={styles.workbench}>
    <header className={styles.header}><div className={styles.identity}><span className={styles['device-icon']}><Monitor size={22} /></span><div><strong>{bootstrap.deviceName}</strong><small>{copy.title}</small></div></div><Space size="middle"><Tag icon={<ShieldCheck size={13} />} color={closed ? undefined : stats?.path ? 'blue' : undefined}>{path}</Tag>{stats?.path && !closed ? <span className={styles.metric}>{Math.round(stats.rtt_ms)} ms</span> : null}<span className={styles.metric}>↑ {Math.round(stats?.send_bytes_per_second ?? 0)} B/s · ↓ {Math.round(stats?.receive_bytes_per_second ?? 0)} B/s</span><Popover title={copy.details} content={<Descriptions size="small" column={1} items={[{ key: 'transport', label: 'WebRTC', children: stats?.path ? `${stats.protocol.toUpperCase()} · ${stats.encryption}` : '—' }, { key: 'ip', label: 'IP', children: stats?.ip_version?.toUpperCase() ?? '—' }, { key: 'ice', label: 'ICE', children: stats?.local_candidate ? `${stats.local_candidate} / ${stats.remote_candidate}` : '—' }, ...(stats?.relay_protocol ? [{ key: 'turn', label: 'TURN', children: stats.relay_protocol.toUpperCase() }] : [])]} />}><Button type="text" icon={<Info size={17} />} aria-label={copy.details} /></Popover><Button icon={<RefreshCw size={15} />} loading={connecting} disabled={!closed && connection?.state !== 'recovering'} onClick={reconnect}>{copy.reconnect}</Button><Button icon={<Unplug size={15} />} disabled={closed || connecting} onClick={() => void bridge.disconnect().then(value => { if (unwrap(value)) setClosed(true) }).catch(setError)}>{copy.disconnect}</Button></Space></header>
    {error ? <Alert type="warning" showIcon title={remoteErrorText(copy, error)} closable onClose={() => setError(undefined)} /> : null}
    {readError && !closed ? <Alert type="warning" showIcon title={isTransientRemoteReadError(readError) ? copy.syncUnavailable : remoteErrorText(copy, readError)} action={<Button onClick={() => void refresh()}>{copy.refresh}</Button>} /> : null}
    <div className={styles.body}><aside className={styles.sidebar}>{renderAgent ? <Button className={styles['agent-entry']} type={agentSelected ? 'primary' : 'default'} icon={<Bot size={17} />} disabled={closed || connecting} onClick={openAgent}>{copy.agent}</Button> : null}<Input prefix={<Search size={15} />} placeholder={copy.search} aria-label={copy.search} value={filter} onChange={event => setFilter(event.target.value)} allowClear /><div className={styles['section-title']}>{copy.hosts}<Button type="text" size="small" icon={<RefreshCw size={13} />} aria-label={copy.refresh} onClick={() => void refresh()} /></div><RemoteHostList hosts={inventory?.hosts ?? []} filter={filter} disabled={busy || closed || connecting || connection?.state !== 'connected'} copy={copy} create={(id, kind) => void create(id, kind)} /><div className={styles['section-title']}>{copy.sessions}<span>{sessions.length}</span></div><div className={styles.resources}>{sessions.map(session => <div className={styles['session-row']} key={session.id}><button className={`${styles.session} ${selected === session.id ? styles.active : ''}`} onClick={() => open(session)}>{session.kind === 'ssh' ? <Terminal size={16} /> : <Folder size={16} />}<span>{name(session)}</span><Circle size={6} fill="currentColor" className={session.state === 'connected' ? styles.online : ''} />{session.origin === 'remote' ? <Monitor size={12} /> : null}</button><Popconfirm title={copy.closeSession} description={copy.closeSessionHint} okText={copy.confirm} cancelText={copy.cancel} onConfirm={() => endSession(session)}><Button type="text" size="small" disabled={closed} icon={<X size={12} />} aria-label={copy.closeSession} /></Popconfirm></div>)}</div></aside>
      <main className={styles.main}>{client && agentOpened && renderAgent && !closed ? <div className={styles['agent-surface']} hidden={!agentSelected}>{renderAgent(client, agentSelected, quote)}</div> : null}{agentSelected && renderAgent && !closed ? null : closed ? <Empty image={<Unplug size={42} />} description={copy.disconnected}><Button type="primary" icon={<RefreshCw size={15} />} onClick={reconnect}>{copy.reconnect}</Button></Empty> : !client ? <Spin size="large" description={copy.connecting}><div className={styles.loading} /></Spin> : tabs.length ? <RemoteSessionPanels onQuote={inventory?.agentEnabled && renderAgent ? (session, text) => { setQuote({ key: Date.now(), text, sessionId: session.id, capturedAt: new Date().toISOString() }); openAgent() } : undefined} key={connection?.id} client={client} tabs={tabs} selected={selected} inventory={inventory} localTasks={localTasks} copy={copy} theme={bootstrap.theme} name={name} select={setSelected} close={id => { const remaining = tabs.filter(tab => tab.id !== id); setTabs(remaining); if (id === selected) setSelected(remaining[remaining.length - 1]?.id ?? '') }} changed={() => void refresh()} /> : <div className={styles.empty}><div className={styles['empty-icon']}><Terminal size={34} /></div><h1>{copy.empty}</h1><p>{copy.emptyHint}</p><span><ShieldCheck size={14} />{copy.shellNotice}<ChevronRight size={14} /></span></div>}</main>
    </div>
    {client && !closed ? <RemoteTransfers client={client} tasks={inventory?.transfers ?? []} localTasks={localTasks} operations={inventory?.operations ?? []} sessions={inventory?.sessions ?? []} copy={copy} changed={() => void refresh()} /> : null}
    <footer className={styles.footer}><span><ShieldCheck size={12} />{connection?.state === 'recovering' ? copy.recovering : connection && !closed ? copy.connected : closed ? copy.disconnected : copy.connecting}</span><span>{copy.sessions} · {inventory?.sessions.length ?? 0}</span></footer>
  </div>
}
