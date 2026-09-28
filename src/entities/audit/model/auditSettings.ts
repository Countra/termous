export interface AuditSettings {
  enabled: boolean
  retention_days: number
  max_records: number
}

export function decodeAuditSettings(value: unknown): AuditSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid audit settings response')
  const settings = value as Record<string, unknown>
  if (typeof settings.enabled !== 'boolean' || !Number.isSafeInteger(settings.retention_days) || !Number.isSafeInteger(settings.max_records)) throw new Error('Invalid audit settings response')
  const days = Number(settings.retention_days), records = Number(settings.max_records)
  if (days < 1 || days > 3650 || (records !== 0 && (records < 1000 || records > 1_000_000))) throw new Error('Invalid audit settings response')
  return { enabled: settings.enabled, retention_days: days, max_records: records }
}
