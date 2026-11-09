import { isDesktopControlSnapshot, type DesktopControlSnapshot } from '#common/contracts'
import { retireWebSocket } from '#shared/websocket'

// 断线即清空展示；重连只读取最新快照，不重放历史状态。
export function subscribeDesktopControls(url: () => string, listener: (value: DesktopControlSnapshot | null) => void): () => void {
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  const connect = () => {
    if (stopped) return
    try {
      const ws = new WebSocket(url())
      socket = ws
      const disconnect = () => {
        if (stopped || socket !== ws) return
        socket = undefined
        listener(null)
        retireWebSocket(ws)
        retry = setTimeout(connect, 2000)
      }
      ws.onmessage = event => {
        if (stopped || socket !== ws) return
        try {
          const value: unknown = JSON.parse(String(event.data))
          if (!isDesktopControlSnapshot(value)) { disconnect(); return }
          listener(value)
        } catch { disconnect() }
      }
      ws.onerror = disconnect
      ws.onclose = disconnect
    } catch {
      listener(null)
      retry = setTimeout(connect, 2000)
    }
  }
  connect()
  return () => { stopped = true; clearTimeout(retry); if (socket) retireWebSocket(socket) }
}
