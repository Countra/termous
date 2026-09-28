import { decodeNotificationEvent, type AppConfig, type NotificationEvent } from '#common/contracts'

// 独立于 Renderer 生命周期；重连首帧包含保留期内的权威快照。
export class NotificationSubscription {
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private generation = 0
  private failures = 0
  private options: { config(): Promise<AppConfig>; receive(event: NotificationEvent): void; warn(): void }
  constructor(options: NotificationSubscription['options']) { this.options = options }

  async start() {
    const generation = ++this.generation
    if (this.stopped) return
    try {
      const config = await this.options.config()
      if (this.stopped || generation !== this.generation) return
      const url = new URL('/api/v1/notifications/events', config.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      if (config.apiToken) url.searchParams.set('token', config.apiToken)
      const socket = new WebSocket(url)
      this.socket = socket
      socket.onmessage = (event) => {
        if (this.stopped || this.socket !== socket) return
        try {
          if (typeof event.data !== 'string' || event.data.length > 2_000_000) throw new Error('NOTIFICATION_EVENT_INVALID')
          this.options.receive(decodeNotificationEvent(JSON.parse(event.data)))
          this.failures = 0
        } catch { this.options.warn(); socket.close() }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => { if (this.socket === socket) { this.socket = null; this.reconnect() } }
    } catch { this.options.warn(); this.reconnect() }
  }
  private reconnect() {
    if (this.stopped || this.retry) return
    this.retry = setTimeout(() => { this.retry = null; void this.start() }, Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5)))
  }
  close() {
    this.stopped = true
    ++this.generation
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.socket?.close()
    this.socket = null
  }
}
