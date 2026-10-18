import { retireWebSocket } from '#shared/websocket'

export interface AgentWorkspaceObserver {
  open(): void
  event(value: unknown): void
  close(): void
  resync(): Promise<void>
}

export interface AgentWorkspaceSubscription { close(immediate?: boolean): void }

// 本机沿用原 WebSocket 生命周期；远控可注入连接级订阅，不伪造网络地址。
export function subscribeLocalWorkspace(
  url: string,
  observer: AgentWorkspaceObserver,
  factory: (url: string) => WebSocket,
): AgentWorkspaceSubscription {
  const socket = factory(url)
  socket.addEventListener('open', observer.open)
  socket.addEventListener('message', (message: MessageEvent<string>) => {
    try { observer.event(JSON.parse(String(message.data))) } catch { socket.close() }
  })
  socket.addEventListener('error', () => socket.close())
  socket.addEventListener('close', observer.close)
  return { close: immediate => { if (immediate) socket.close(); else retireWebSocket(socket) } }
}
