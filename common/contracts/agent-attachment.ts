export interface AgentTerminalReferenceOrigin {
  kind: 'terminal_selection'
  source_session_id: string
  host_name: string
  captured_at: string
  line_count: number
}

export function isAgentTerminalReferenceOrigin(value: unknown): value is AgentTerminalReferenceOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return Object.keys(source).length === 5
    && source.kind === 'terminal_selection'
    && typeof source.source_session_id === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/u.test(source.source_session_id)
    && typeof source.host_name === 'string'
    && source.host_name.trim().length > 0
    && !source.host_name.includes('\0')
    && new TextEncoder().encode(source.host_name).byteLength <= 200
    && typeof source.captured_at === 'string'
    && validUTCTimestamp(source.captured_at)
    && typeof source.line_count === 'number'
    && Number.isSafeInteger(source.line_count)
    && source.line_count >= 1
    && source.line_count <= 262145
    && new TextEncoder().encode(JSON.stringify(source)).byteLength <= 1024
}

function validUTCTimestamp(value: string) {
  if (value.startsWith('0000-') || /^0001-01-01T00:00:00(?:\.0{1,9})?(?:Z|\+00:00)$/u.test(value)) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/u.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
}
