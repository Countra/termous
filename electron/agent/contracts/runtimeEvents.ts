export type RuntimeEventKind =
  | 'status'
  | 'message_delta'
  | 'message_part'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'usage'
  | 'request_usage'
  | 'progress'
  | 'error'
  | 'retry'
  | 'compaction'
  | 'context_usage'
  | 'steer_applied'

export interface RuntimeRetryEvent {
  retry_id: string
  assistant_message_id: string
  purpose: 'response' | 'compaction'
  after_part_sequence: number
  status: 'waiting' | 'requesting' | 'completed' | 'failed' | 'cancelled'
  attempt: number
  max_retries: 3
  delay_ms: number
  error_message: string
}

export interface RuntimeEventInput {
  event_id: string
  generation: number
  sequence: number
  kind: RuntimeEventKind
  payload: Record<string, unknown>
}

export interface RuntimeSteerInput {
  event_id: string
  sequence: number
  client_request_id: string
  text: string
}

export interface RuntimeSteerResult {
  last_sequence: number
  message_id: string
  part_id: string
}

export function validRuntimeSteerInput(value: RuntimeSteerInput) {
  return typeof value.event_id === 'string'
    && value.event_id.length > 0
    && value.event_id.length <= 128
    && Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && typeof value.client_request_id === 'string'
    && value.client_request_id.length > 0
    && value.client_request_id.length <= 128
    && typeof value.text === 'string'
    && value.text.trim().length > 0
    && Buffer.byteLength(value.text, 'utf8') <= 1 << 20
}

export interface RuntimeAuditEvent {
  id: string
  tool_call_id: string
  tool_name: string
  phase: 'start' | 'end'
  outcome: string
  occurred_at: string
  duration_ms: number
  parameters?: Record<string, unknown>
  result?: Record<string, unknown>
}
