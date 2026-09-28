import type { AuditSettings } from '#entities/audit'

export interface AuditSettingsGateway {
  auditSettings(signal?: AbortSignal): Promise<AuditSettings>
  updateAuditSettings(patch: Partial<AuditSettings>, signal?: AbortSignal): Promise<AuditSettings>
}
