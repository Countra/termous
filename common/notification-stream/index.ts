import { decodeNotificationEvent, type NotificationEvent } from '#common/contracts'

interface Options {
  url(): string | Promise<string>
  receive(event: NotificationEvent): void
  disconnected(): void
}

// Renderer 与主进程共用消息中心连接生命周期；业务状态和原生通知投递仍由各自维护。
export class NotificationStream {
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private readyDeadline: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private generation = 0
  private failures = 0
  private options: Options

  constructor(options: Options) { this.options = options }

  async start() {
    if (!this.stopped) return
    this.stopped = false
    await this.connect()
  }

  private async connect() {
    const generation = ++this.generation
    try {
      const url = this.options.url()
      // 本地同步地址不增加微任务延迟；主进程重连时重新读取 Core 地址及凭据。
      const resolved = typeof url === 'string' ? url : await url
      if (this.stopped || generation !== this.generation) return
      const socket = new WebSocket(resolved)
      this.socket = socket
      let ready = false
      this.readyDeadline = setTimeout(() => this.disconnect(generation), 10_000)
      socket.onmessage = (event) => {
        if (this.stopped || generation !== this.generation) return
        try {
          if (typeof event.data !== 'string' || event.data.length > 2_000_000) throw new Error('NOTIFICATION_EVENT_INVALID')
          const decoded = decodeNotificationEvent(JSON.parse(event.data))
          if (!ready && decoded.type !== 'snapshot') throw new Error('NOTIFICATION_SNAPSHOT_REQUIRED')
          this.options.receive(decoded)
          ready = true
          this.clearDeadline()
          this.failures = 0
        } catch { this.disconnect(generation) }
      }
      socket.onerror = () => this.disconnect(generation)
      socket.onclose = () => this.disconnect(generation)
    } catch { this.disconnect(generation) }
  }

  private disconnect(generation: number) {
    if (this.stopped || generation !== this.generation) return
    ++this.generation
    this.releaseSocket()
    // 不依赖失败连接最终触发 close，握手卡住或错误后均能建立新的权威快照。
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5)))
    this.options.disconnected()
  }

  private clearDeadline() {
    if (this.readyDeadline) clearTimeout(this.readyDeadline)
    this.readyDeadline = null
  }

  private releaseSocket() {
    this.clearDeadline()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
  }

  close() {
    this.stopped = true
    ++this.generation
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.releaseSocket()
  }
}
