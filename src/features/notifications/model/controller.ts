import { decodeNotificationEvent, emptyNotificationState, mergeNotificationEvent, type NotificationGateway, type NotificationState } from '#entities/notification'

export class NotificationController {
  private state: NotificationState = emptyNotificationState
  private listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private failures = 0
  readonly api: NotificationGateway
  constructor(api: NotificationGateway) { this.api = api }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private commit(next: NotificationState) { this.state = next; for (const listener of this.listeners) listener() }
  start() { this.stopped = false; this.connect() }
  private connect() {
    if (this.stopped || this.socket) return
    try {
      const socket = new WebSocket(this.api.eventsUrl())
      this.socket = socket
      socket.onmessage = (event) => {
        if (this.socket !== socket || this.stopped) return
        try {
          if (typeof event.data !== 'string' || event.data.length > 2_000_000) throw new Error('NOTIFICATION_EVENT_INVALID')
          this.commit(mergeNotificationEvent(this.state, decodeNotificationEvent(JSON.parse(event.data))))
          this.failures = 0
        } catch { socket.close() }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => { if (this.socket === socket) { this.socket = null; this.reconnect() } }
    } catch { this.reconnect() }
  }
  private reconnect() {
    if (this.stopped || this.timer) return
    this.commit({ ...this.state, connected: false, error: true })
    this.timer = setTimeout(() => { this.timer = null; this.connect() }, Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5)))
  }
  close() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.close()
    this.socket = null
  }
}
