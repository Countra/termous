import { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { RemoteDesktopViewerLifecycle } from '../../src/features/remote-desktop/runtime/core/viewerLifecycle'
import { createRemoteDesktopProtocolRegistry } from '../../src/features/remote-desktop/runtime/core/protocolRegistry'
import { createRemoteDesktopRouteRegistry } from '../../src/features/remote-desktop/runtime/core/routeRegistry'
import { RemoteDesktopConnectionMetricsStore } from '../../src/features/remote-desktop/runtime/core/connectionMetricsStore'
import { emptyRemoteDesktopViewerState } from '../../src/features/remote-desktop/runtime/core/viewerContracts'
import { vncProtocolDriver } from '../../src/features/remote-desktop/runtime/protocols/vnc/driver'
import { liveAPI } from './live-client'

// 复用生产挂接状态机；测试轮询只代替会话事件传输，不自行实现交接或重连。
export function LocalVNC() {
  const target = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('等待本机画面')
  const [remote, setRemote] = useState(false)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let sessions = new Map<string, RemoteDesktopSession>()
    let state = { ...emptyRemoteDesktopViewerState }
    let id = ''
    const lifecycle = new RemoteDesktopViewerLifecycle({
      api: () => ({
        createRemoteDesktopAttachTicket: () => liveAPI('local', {}),
        consumeRemoteDesktopTargetAuth: (_id, _generation, ticket) => liveAPI('credential', { ticket }),
        remoteDesktopStreamUrl: ticket => `ws://${location.host}/fixture/stream?ticket=${encodeURIComponent(ticket.ticket)}`,
        takeRemoteDesktopControl: () => liveAPI('reclaim', { read_only: false }),
        execution: {
          connect: (_id, _generation, readOnly) => liveAPI('executor-ticket', { read_only: readOnly }),
          reclaim: (_id, _generation, readOnly) => liveAPI('reclaim', { read_only: readOnly }),
        },
      }),
      protocolRegistry: createRemoteDesktopProtocolRegistry([vncProtocolDriver]),
      routeRegistry: createRemoteDesktopRouteRegistry([{ id: 'direct', configVersion: 1 }, { id: 'ssh_tunnel', configVersion: 1 }]),
      metrics: new RemoteDesktopConnectionMetricsStore(), surfaceClassName: 'live-vnc-surface',
      session: id => sessions.get(id), profile: () => undefined, viewerState: () => state,
      commitViewerState: (_id, patch) => {
        state = { ...state, ...patch }
        if (!stopped) setStatus(`${state.connection}${state.controlOwned ? ' · 本机控制中' : ''}${state.errorCode ? ` · ${state.errorCode}` : ''}`)
      },
    })
    const update = async () => {
      try {
        const session: RemoteDesktopSession = await liveAPI('local-state')
        if (stopped || !target.current) return
        lifecycle.reconcileSessions(sessions, [session])
        sessions = new Map([[session.id, session]])
        setRemote(!!session.remote_viewer)
        if (!id) { id = session.id; state = vncProtocolDriver.initialViewerState(session); lifecycle.registerViewport(id, target.current) }
        lifecycle.ensureViewer(id)
      } catch (error) { if (!stopped) setStatus(String(error)); return }
      if (!stopped) timer = setTimeout(() => { void update() }, 250)
    }
    void update()
    return () => { stopped = true; clearTimeout(timer); lifecycle.disposeAll() }
  }, [])
  return <section style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center' }}><span>{remote ? '桌面已切换至远端' : status}</span><Button onClick={() => { void liveAPI('reclaim', { read_only: false }).catch(error => setStatus(String(error))) }}>收回桌面</Button></div>
    <div ref={target} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }} />
  </section>
}
