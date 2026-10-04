import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Empty, Input, Popconfirm, Popover, Space, Spin, Tag, Tooltip } from 'antd'
import { Cable, ChevronRight, Circle, Folder, Info, Monitor, RefreshCw, Search, ShieldCheck, Terminal, Unplug, X } from 'lucide-react'
import type { RemoteBootstrap, RemoteConnection, RemoteWindowBridge, RemoteLocalTask } from '#common/contracts'
import { RemoteClient, unwrap, type Inventory, type Session } from '#entities/remote-control'
import { RemoteTransfers, remoteCopy, remoteErrorText } from '#features/remote-control'
import styles from './RemoteWorkbench.module.scss'
import { RemoteSessionPanels } from './RemoteSessionPanels'

export function RemoteWorkbench({ bridge, bootstrap }: { bridge: RemoteWindowBridge; bootstrap: RemoteBootstrap }) {
  const copy = remoteCopy(bootstrap.language)
  const [client, setClient] = useState<RemoteClient>()
  const [connection, setConnection] = useState<RemoteConnection>()
  const [inventory, setInventory] = useState<Inventory>()
  const [localTasks, setLocalTasks] = useState<RemoteLocalTask[]>([])
  const [error, setError] = useState<unknown>()
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [tabs, setTabs] = useState<Session[]>([])
  const [selected, setSelected] = useState('')
  const liveClient = useRef<RemoteClient | undefined>(undefined)

  const refresh = useCallback(async () => {
    const current = liveClient.current
    if (!current) return
    const [result, local] = await Promise.all([current.request({ operation: { case: 'inventory', value: {} } }), current.localTransfers()])
    if (liveClient.current !== current) return
    setLocalTasks(local)
    if (result.result.case === 'inventory') {
      const value = result.result.value
      setInventory(value)
      setTabs(previous => previous.map(tab => value.sessions.find(item => item.id === tab.id) ?? tab))
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
          if (++polls % 3 === 0) await refresh()
        }
      } catch (reason) { if (active) setError(reason) }
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    void (async () => {
      const value = unwrap(await bridge.connection())
      if (!active) return
      current = new RemoteClient(bridge, value)
      liveClient.current = current
      current.start(() => { if (active) setClosed(true) })
      setClient(current); setConnection(value)
      await refresh()
      if (active) timer = setTimeout(() => void poll(), 2000)
    })().catch(reason => { if (active) { setError(reason); setClosed(true) } })
    return () => { active = false; clearTimeout(timer); current?.dispose(); if (liveClient.current === current) liveClient.current = undefined }
  }, [bridge, refresh])

  const open = (session: Session) => {
    if (!tabs.some(tab => tab.id === session.id)) {
      if (tabs.length >= 12) { setError({ code: 'remote_capacity_exceeded' }); return }
      setTabs(previous => [...previous, session])
    }
    setSelected(session.id)
  }
  const create = async (profileId: string, kind: 'ssh' | 'sftp') => {
    if (!client || busy || closed) return
    setBusy(true); setError(undefined)
    try {
      const result = await client.request({ operation: { case: 'createSession', value: { operationId: crypto.randomUUID(), profileId, kind, columns: 100, rows: 30 } } })
      if (result.result.case === 'session') open(result.result.value)
      await refresh()
    } catch (reason) { setError(reason) } finally { setBusy(false) }
  }
  const endSession = async (session: Session) => {
    if (!client) return
    try { await client.request({ operation: { case: 'session', value: { action: 'close', operationId: crypto.randomUUID(), sessionId: session.id, generation: session.generation } } }); await refresh() } catch (reason) { setError(reason) }
  }
  const name = (session: Session) => inventory?.profiles.find(profile => profile.id === session.profileId)?.name || session.name || session.id
  const profiles = useMemo(() => (inventory?.profiles ?? []).filter(item => `${item.name} ${item.host} ${item.username}`.toLowerCase().includes(filter.toLowerCase())), [inventory, filter])
  const sessions = (inventory?.sessions ?? []).filter(item => `${name(item)} ${item.kind}`.toLowerCase().includes(filter.toLowerCase()))
  const stats = connection?.stats
  const path = closed ? copy.disconnected : stats?.path === 'relay' ? copy.relay : stats?.path === 'direct' ? `${copy.direct} · ${stats.protocol.toUpperCase()}` : copy.connecting

  return <div className={styles.workbench}>
    <header className={styles.header}><div className={styles.identity}><span className={styles['device-icon']}><Monitor size={22} /></span><div><strong>{bootstrap.deviceName}</strong><small>{copy.title}</small></div></div><Space size="middle"><Tag icon={<ShieldCheck size={13} />} color={closed ? undefined : stats?.path ? 'blue' : undefined}>{path}</Tag>{stats?.path && !closed ? <span className={styles.metric}>{Math.round(stats.rtt_ms)} ms</span> : null}<span className={styles.metric}>↑ {Math.round(stats?.send_bytes_per_second ?? 0)} B/s · ↓ {Math.round(stats?.receive_bytes_per_second ?? 0)} B/s</span><Popover title={copy.details} content={<Descriptions size="small" column={1} items={[{ key: 'transport', label: 'WebRTC', children: stats?.path ? `${stats.protocol.toUpperCase()} · ${stats.encryption}` : '—' }, { key: 'ip', label: 'IP', children: stats?.ip_version?.toUpperCase() ?? '—' }, { key: 'ice', label: 'ICE', children: stats?.local_candidate ? `${stats.local_candidate} / ${stats.remote_candidate}` : '—' }, ...(stats?.relay_protocol ? [{ key: 'turn', label: 'TURN', children: stats.relay_protocol.toUpperCase() }] : [])]} />}><Button type="text" icon={<Info size={17} />} aria-label={copy.details} /></Popover><Button icon={<Unplug size={15} />} disabled={closed} onClick={() => void bridge.disconnect().then(value => { if (unwrap(value)) setClosed(true) }).catch(setError)}>{copy.disconnect}</Button></Space></header>
    {error ? <Alert type="warning" showIcon title={remoteErrorText(copy, error)} closable onClose={() => setError(undefined)} /> : null}
    <div className={styles.body}><aside className={styles.sidebar}><Input prefix={<Search size={15} />} placeholder={copy.search} aria-label={copy.search} value={filter} onChange={event => setFilter(event.target.value)} allowClear /><div className={styles['section-title']}>{copy.profiles}<Button type="text" size="small" icon={<RefreshCw size={13} />} aria-label={copy.refresh} onClick={() => void refresh().catch(setError)} /></div><div className={styles.resources}>{profiles.map(profile => <div className={styles.profile} key={profile.id}><div className={styles['profile-name']}><Cable size={16} /><strong>{profile.name}</strong></div><small>{profile.username}@{profile.host}</small><Space><Tooltip title={copy.newTerminal}><Button size="small" disabled={busy || closed || !profile.available} icon={<Terminal size={14} />} onClick={() => void create(profile.id, 'ssh')}>{copy.terminal}</Button></Tooltip><Tooltip title={copy.newFiles}><Button size="small" disabled={busy || closed || !profile.available} icon={<Folder size={14} />} onClick={() => void create(profile.id, 'sftp')}>{copy.files}</Button></Tooltip></Space></div>)}</div><div className={styles['section-title']}>{copy.sessions}<span>{sessions.length}</span></div><div className={styles.resources}>{sessions.map(session => <div className={styles['session-row']} key={session.id}><button className={`${styles.session} ${selected === session.id ? styles.active : ''}`} onClick={() => open(session)}>{session.kind === 'ssh' ? <Terminal size={16} /> : <Folder size={16} />}<span>{name(session)}</span><Circle size={6} fill="currentColor" className={session.state === 'connected' ? styles.online : ''} />{session.origin === 'remote' ? <Monitor size={12} /> : null}</button><Popconfirm title={copy.closeSession} description={copy.closeSessionHint} okText={copy.confirm} cancelText={copy.cancel} onConfirm={() => endSession(session)}><Button type="text" size="small" disabled={closed} icon={<X size={12} />} aria-label={copy.closeSession} /></Popconfirm></div>)}</div></aside>
      <main className={styles.main}>{closed ? <Empty image={<Unplug size={42} />} description={copy.disconnected}><Button onClick={() => void bridge.close()}>{copy.close}</Button></Empty> : !client ? <Spin size="large" description={copy.connecting}><div className={styles.loading} /></Spin> : tabs.length ? <RemoteSessionPanels client={client} tabs={tabs} selected={selected} inventory={inventory} copy={copy} theme={bootstrap.theme} name={name} select={setSelected} close={id => { const remaining = tabs.filter(tab => tab.id !== id); setTabs(remaining); if (id === selected) setSelected(remaining[remaining.length - 1]?.id ?? '') }} changed={() => void refresh().catch(setError)} /> : <div className={styles.empty}><div className={styles['empty-icon']}><Terminal size={34} /></div><h1>{copy.empty}</h1><p>{copy.emptyHint}</p><span><ShieldCheck size={14} />{copy.shellNotice}<ChevronRight size={14} /></span></div>}</main>
    </div>
    {client && !closed ? <RemoteTransfers client={client} tasks={inventory?.transfers ?? []} localTasks={localTasks} operations={inventory?.operations ?? []} sessions={inventory?.sessions ?? []} copy={copy} changed={() => void refresh().catch(setError)} /> : null}
    <footer className={styles.footer}><span><ShieldCheck size={12} />{connection && !closed ? copy.connected : closed ? copy.disconnected : copy.connecting}</span><span>{copy.sessions} · {inventory?.sessions.length ?? 0}</span></footer>
  </div>
}
