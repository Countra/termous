import type { AuditEvent, AuditPage, AuditQuery, AuditStatus } from '#entities/audit'

export interface AuditGateway {
  events(query: AuditQuery, signal?: AbortSignal): Promise<AuditPage>
  event(id: string, signal?: AbortSignal): Promise<AuditEvent>
  status(signal?: AbortSignal): Promise<AuditStatus>
}
