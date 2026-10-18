export type AuditSource = 'ai_assistant' | 'mcp' | 'user'
export type AuditLevel = 'info' | 'warn' | 'error'
export type AuditEventType = 'tool' | 'approval' | 'operation'
export type AuditSearchField = 'all' | 'command' | 'path' | 'actor' | 'target' | 'identifier' | 'summary' | 'action'
export type AuditSortField = 'received_at' | 'source' | 'action' | 'scope' | 'outcome' | 'actor_name' | 'resource_id' | 'duration_ms'

export interface AuditEvent {
  id: string
  occurred_at: string
  received_at: string
  source: AuditSource
  producer: string
  level: AuditLevel
  type: AuditEventType
  action: string
  scope: string
  outcome: string
  actor_id: string
  actor_name: string
  user_agent?: string
  correlation_id: string
  request_id?: string
  resource_type?: string
  resource_id?: string
  duration_ms: number
  summary: string
  details_version: number
  details?: Record<string, unknown>
}

export interface AuditPage { items: AuditEvent[]; next_cursor?: string }

export interface AuditStatus {
  enabled: boolean
  max_records: number
  state: string
  queued: number
  queued_bytes: number
  dropped: number
  write_failures: number
  written: number
  last_error?: string
  last_write_at?: string
  retention_days: number
}

export interface AuditQuery {
  search?: string
  search_field?: AuditSearchField
  source?: string
  level?: string
  type?: string
  scope?: string
  action?: string
  outcome?: string
  correlation_id?: string
  from?: string
  until?: string
  cursor?: string
  limit?: number
  sort_by?: AuditSortField
  sort_order?: 'asc' | 'desc'
}

export type AuditDetails =
  | { kind: AuditEventType; context: Record<string, unknown>; parameters: Record<string, unknown>; result: Record<string, unknown>; truncated: boolean }
  | { kind: 'unknown'; raw: Record<string, unknown> }
export { decodeAuditSettings, type AuditSettings } from './model/auditSettings.ts'
