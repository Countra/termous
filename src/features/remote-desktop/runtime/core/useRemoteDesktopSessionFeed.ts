import { useEffect, useRef } from 'react'
import type { DesktopPointerEvent } from '#common/contracts'
import type {
  RemoteDesktopSession,
  RemoteDesktopTelemetryEvent,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '../../api/remoteDesktopGateway.ts'
import { decodeRemoteDesktopSessionEvent } from '../../model/sessionEventProtocol.ts'

const reconnectDelayInitial = 800
const reconnectDelayMaximum = 5000

interface RemoteDesktopSessionFeedOptions {
  api: RemoteDesktopGateway
  enabled: boolean
  initialSessions: () => RemoteDesktopSession[]
  onSnapshot: (sessions: RemoteDesktopSession[]) => void
  onUpsert: (session: RemoteDesktopSession) => void
  onRemove: (sessionId: string) => void
  onTelemetry: (event: RemoteDesktopTelemetryEvent) => void
  onPointer: (event: DesktopPointerEvent) => void
  onPointerDisconnect: () => void
}

export function useRemoteDesktopSessionFeed({
  api,
  enabled,
  initialSessions,
  onSnapshot,
  onUpsert,
  onRemove,
  onTelemetry,
  onPointer,
  onPointerDisconnect,
}: RemoteDesktopSessionFeedOptions) {
  const reconcileRevisionRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      reconcileRevisionRef.current += 1
      onSnapshot([])
      return undefined
    }
    // AppData 只提供启动快照；从此处开始由事件流和权威 GET 单独维护运行态。
    onSnapshot(initialSessions())
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let reconnectDelay = reconnectDelayInitial

    const reconcile = async () => {
      const revision = ++reconcileRevisionRef.current
      try {
        const sessions = await api.remoteDesktopSessions()
        if (!disposed && revision === reconcileRevisionRef.current) {
          onSnapshot(sessions)
        }
      } catch {
        // 实时通道会继续重连；短暂网络故障期间保留最后一次权威会话。
      }
    }
    const connect = () => {
      if (disposed) {
        return
      }
      const url = new URL(api.remoteDesktopSessionEventsUrl())
      url.searchParams.set('automation_pointer', '1')
      const connection = new WebSocket(url.toString())
      socket = connection
      connection.onopen = () => {
        if (disposed || socket !== connection) return
        reconnectDelay = reconnectDelayInitial
        void reconcile()
      }
      connection.onmessage = (message: MessageEvent<string>) => {
        if (disposed || socket !== connection) return
        const event = decodeRemoteDesktopSessionEvent(message.data)
        if (!event) {
          // 无效视觉投影只丢弃，不能让高频坏消息放大会话 GET 请求。
          try { if (JSON.parse(message.data)?.type === 'automation_pointer') return } catch { /* 非视觉消息仍执行既有校准。 */ }
          void reconcile()
          return
        }
        if (event.type === 'automation_pointer') { onPointer(event); return }
        if (event.type === 'telemetry') {
          onTelemetry(event)
          return
        }
        // 实时事件已推进权威 revision，禁止更早启动的 GET 覆盖新 generation 或复活会话。
        reconcileRevisionRef.current += 1
        if (event.type === 'snapshot') {
          onSnapshot(event.sessions)
        } else if (event.type === 'upsert') {
          onUpsert(event.session)
        } else {
          onRemove(event.session.id)
        }
      }
      connection.onerror = () => { if (!disposed && socket === connection) connection.close() }
      connection.onclose = () => {
        if (disposed || socket !== connection) return
        reconcileRevisionRef.current += 1
        onPointerDisconnect()
        socket = null
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, reconnectDelayMaximum)
        }
      }
    }

    void reconcile()
    connect()
    return () => {
      onPointerDisconnect()
      disposed = true
      reconcileRevisionRef.current += 1
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, enabled, initialSessions, onRemove, onSnapshot, onTelemetry, onUpsert, onPointer, onPointerDisconnect])
}
