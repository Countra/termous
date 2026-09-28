import { useEffect } from 'react'
import { decodeSettingsEvent } from '#entities/settings'
import type { RuntimeGateways } from '../api/runtimeGateways'
import { subscribeLocalSettings } from '../api/gateways/localSettings'

export function useSettingsSubscription(settings: RuntimeGateways['settings'], enabled: boolean) {
  useEffect(() => subscribeLocalSettings(), [])
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshPending = false
    let refreshing = false
    const refresh = async () => {
      refreshPending = true
      if (refreshing) return
      refreshing = true
      try {
        while (refreshPending && !disposed) {
          refreshPending = false
          await settings.settings()
        }
      } catch {
        // 读取失败后重连，服务端的首次 resync 会再次触发读取，不重放任何修改。
        socket?.close()
      } finally { refreshing = false }
    }
    const connect = () => {
      if (disposed) return
      try {
        const current = new WebSocket(settings.eventsUrl())
        socket = current
        current.onmessage = (message: MessageEvent<string>) => {
          if (disposed || socket !== current) return
          try {
            const event = decodeSettingsEvent(JSON.parse(message.data))
            settings.acceptInstance(event.instance_id)
            if (event.type === 'resync' || (settings.getModule(event.module)?.revision ?? 0) < event.revision) void refresh()
          } catch { current.close() }
        }
        current.onerror = () => current.close()
        current.onclose = () => { if (!disposed && socket === current) timer = setTimeout(connect, 1200) }
      } catch { timer = setTimeout(connect, 1200) }
    }
    connect()
    return () => { disposed = true; clearTimeout(timer); socket?.close(); settings.invalidateRequests() }
  }, [settings, enabled])
}
