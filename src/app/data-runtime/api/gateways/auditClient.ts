import type { AuditQuery } from '#entities/audit'
import type { AuditGateway } from '#features/audit'
import { decodeAuditEvent, decodeAuditPage, decodeAuditStatus } from '#features/audit'
import { TermousApiTransport } from '#shared/api'

export class AuditClient extends TermousApiTransport implements AuditGateway {
  events(query: AuditQuery, signal?: AbortSignal) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value))
    return this.request<unknown>(`/api/v1/audit/events?${params}`, { signal }).then(decodeAuditPage)
  }

  event(id: string, signal?: AbortSignal) {
    return this.request<unknown>(`/api/v1/audit/events/${encodeURIComponent(id)}`, { signal }).then(decodeAuditEvent)
  }

  status(signal?: AbortSignal) {
    return this.request<unknown>('/api/v1/audit/status', { signal }).then(decodeAuditStatus)
  }
}
