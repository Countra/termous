import { decodeAuditSettings, type AuditDetails, type AuditEvent, type AuditPage, type AuditStatus } from '#entities/audit'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never { throw new Error('Invalid audit response') }

// 不执行远端 JSON 的任何内容；未知版本同样受大小与深度限制。
function bounded(value: unknown, depth = 0, budget = { nodes: 2048 }): boolean {
  if (--budget.nodes < 0 || depth > 10) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 16_384
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => bounded(item, depth + 1, budget))
  return object(value) && Object.keys(value).length <= 256 && Object.entries(value).every(([key, item]) => key.length <= 512 && bounded(item, depth + 1, budget))
}

export function decodeAuditEvent(value: unknown): AuditEvent {
  if (!object(value)) return invalid()
  for (const key of ['id', 'occurred_at', 'received_at', 'source', 'producer', 'level', 'type', 'action', 'scope', 'outcome', 'actor_id', 'actor_name', 'correlation_id', 'summary']) {
    if (typeof value[key] !== 'string' || value[key].length > 2048) return invalid()
  }
  if (!['ai_assistant', 'mcp', 'user'].includes(String(value.source)) || !['info', 'warn', 'error'].includes(String(value.level)) || !['tool', 'approval', 'operation'].includes(String(value.type))) return invalid()
  for (const key of ['duration_ms', 'details_version']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) return invalid()
  }
  if (!Number.isFinite(Date.parse(String(value.received_at))) || !Number.isFinite(Date.parse(String(value.occurred_at)))) return invalid()
  for (const key of ['user_agent', 'request_id', 'resource_type', 'resource_id']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 2048)) return invalid()
  }
  // 原始命令最多 8 KiB，JSON 转义后仍须完整接收；普通详情维持原来的 16 KiB 上限。
  const command = object(value.details) && object(value.details.parameters) ? value.details.parameters.command : undefined
  const commandLimit = ['termous.commands.dispatch', 'commands.dispatch.finished'].includes(String(value.action)) && typeof command === 'string' && new TextEncoder().encode(command).length <= 8192
  if (value.details !== undefined && (!object(value.details) || !bounded(value.details) || new TextEncoder().encode(JSON.stringify(value.details)).length > (commandLimit ? 80 * 1024 : 16_384))) return invalid()
  return value as unknown as AuditEvent
}

export function decodeAuditPage(value: unknown): AuditPage {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 200 || (value.next_cursor !== undefined && (typeof value.next_cursor !== 'string' || value.next_cursor.length > 4096))) return invalid()
  return { items: value.items.map(decodeAuditEvent), next_cursor: value.next_cursor as string | undefined }
}

export function decodeAuditStatus(value: unknown): AuditStatus {
  if (!object(value) || typeof value.state !== 'string') return invalid()
  for (const key of ['queued', 'queued_bytes', 'dropped', 'write_failures', 'written', 'retention_days']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) return invalid()
  }
  if (value.last_error !== undefined && (typeof value.last_error !== 'string' || value.last_error.length > 2048)) return invalid()
  if (value.last_write_at !== undefined && (typeof value.last_write_at !== 'string' || !Number.isFinite(Date.parse(value.last_write_at)))) return invalid()
  const settings = decodeAuditSettings({ enabled: value.enabled === undefined ? true : value.enabled, retention_days: value.retention_days, max_records: value.max_records === undefined ? 0 : value.max_records })
  return { ...value, ...settings } as unknown as AuditStatus
}

export function decodeAuditDetails(event: AuditEvent): AuditDetails {
  const raw = event.details ?? {}
  if (event.details_version !== 1 || !['context', 'parameters', 'result', 'truncated'].every((key) => raw[key] === undefined || (key === 'truncated' ? typeof raw[key] === 'boolean' : object(raw[key])))) return { kind: 'unknown', raw }
  return { kind: event.type, context: raw.context as Record<string, unknown> ?? {}, parameters: raw.parameters as Record<string, unknown> ?? {}, result: raw.result as Record<string, unknown> ?? {}, truncated: raw.truncated === true }
}
