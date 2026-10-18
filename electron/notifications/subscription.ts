import type { AppConfig, NotificationEvent } from '#common/contracts'
import { NotificationStream } from '#common/notification-stream'

// 独立于 Renderer 生命周期；重连首帧包含保留期内的权威快照。
export class NotificationSubscription {
  private stream: NotificationStream
  private stopped = false
  constructor(options: { config(): Promise<AppConfig>; receive(event: NotificationEvent): void; warn(): void }) {
    this.stream = new NotificationStream({
      url: async () => {
        const config = await options.config()
        const url = new URL('/api/v1/notifications/events', config.apiBaseUrl)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        if (config.apiToken) url.searchParams.set('token', config.apiToken)
        return url.toString()
      },
      receive: options.receive,
      disconnected: options.warn,
    })
  }
  async start() {
    if (!this.stopped) await this.stream.start()
  }
  close() {
    this.stopped = true
    this.stream.close()
  }
}
