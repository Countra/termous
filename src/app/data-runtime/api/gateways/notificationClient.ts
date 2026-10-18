import type { NotificationGateway } from '#entities/notification'
import { TermousApiTransport } from '#shared/api'

export class NotificationClient extends TermousApiTransport implements NotificationGateway {
  eventsUrl() { return this.websocketUrl('/api/v1/notifications/events') }
  async read(body: { ids: string[] } | { watermark: number }) { await this.request('/api/v1/notifications/read', { method: 'POST', body }) }
  async dismiss(body: { ids: string[] } | { watermark: number }) { await this.request('/api/v1/notifications/dismiss', { method: 'POST', body }) }
}
