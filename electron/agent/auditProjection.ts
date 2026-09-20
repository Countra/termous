import { isRecord } from './protocol.ts'

const parameterFields = new Set([
  'command', 'commands', 'path', 'paths', 'remote_path', 'remote_paths', 'local_path', 'local_paths',
  'source_path', 'target_path', 'destination_path', 'session_id', 'session_ids', 'host_id', 'ssh_profile_id',
  'file_access_profile_id', 'file_session_id', 'target_file_session_id', 'profile_id', 'task_id', 'operation_id',
  'approval_id', 'client_request_id', 'name', 'new_name', 'source', 'target', 'mappings', 'entries', 'recursive',
  'overwrite', 'overwrite_strategy', 'mode', 'action', 'unit_id', 'container_id', 'pid', 'signal', 'enabled',
  'port', 'address', 'resource_uri', 'uri', 'scope', 'query', 'limit', 'offset', 'max_bytes', 'encoding', 'force',
  'expected_generation',
  'source_file_session_id', 'target_session_ids', 'source_paths', 'excluded_paths', 'directory', 'remote_dir',
  'local_dir', 'target_dir', 'overwrite_policy', 'transfer_id', 'expected_connection_generation',
  'source_connection_generation', 'target_connection_generation',
])
const resultFields = new Set([
  'id', 'task_id', 'operation_id', 'approval_id', 'session_id', 'file_session_id', 'status', 'state', 'phase',
  'code', 'message', 'error', 'error_code', 'error_message', 'retryable', 'partial', 'unknown_targets', 'exit_code', 'exit_code_known', 'duration_ms', 'total',
  'total_files', 'completed_files', 'total_bytes', 'completed_bytes', 'task', 'operation', 'approval', 'result',
  'transfer', 'session', 'outcome', '_truncated',
])
const bodyFields = new Set(['content', 'body', 'text', 'output', 'stdout', 'stderr', 'data', 'image', 'images', 'messages', 'prompt', 'system_prompt'])

interface ProjectionBudget { nodes: number; bytes: number; truncated: boolean }

function scrub(value: unknown, depth: number, budget: ProjectionBudget): unknown {
  if (--budget.nodes < 0 || depth > 6 || budget.bytes <= 0) { budget.truncated = true; return '[内容已省略]' }
  if (typeof value === 'string') {
    if (value.length > 64 * 1024) { budget.truncated = true; return '[内容已省略]' }
    const sanitized = value
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[已隐藏]')
      .replace(/(\b(?:authorization|proxy-authorization|cookie)\s*:\s*)[^\r\n"']+/gi, '$1[已隐藏]')
      .replace(/(\b(?:curl|wget|http|httpie)\b[^\r\n;]*?\s(?:-u|--user|--password|--http-password)(?:=|\s+))("[^"\r\n]*"|'[^'\r\n]*'|[^\s;]+)/gi, '$1[已隐藏]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
      .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[已隐藏]@')
      .replace(/(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential|signature|x-amz-signature|x-amz-credential|x-amz-security-token|\bsig\b)(["']?\s*[:=]\s*|\s+)("[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;]+)/gi, '$1=[已隐藏]')
    const limit = Math.min(4096, budget.bytes)
    let result = ''
    let bytes = 0
    for (const character of sanitized) {
      const size = Buffer.byteLength(character, 'utf8')
      if (bytes + size > limit) break
      result += character
      bytes += size
    }
    budget.bytes -= bytes
    if (result !== sanitized) { budget.truncated = true; return `${result}[已截断]` }
    return result
  }
  if (Array.isArray(value)) {
    if (value.length > 64) budget.truncated = true
    return value.slice(0, 64).map((item) => scrub(item, depth + 1, budget))
  }
  if (!isRecord(value)) return typeof value === 'number' && !Number.isFinite(value) ? null : value
  const entries = Object.entries(value)
  if (entries.length > 64 || value._truncated === true) budget.truncated = true
  return Object.fromEntries(entries.slice(0, 64).map(([key, item]) => {
    const compact = key.toLowerCase().replace(/[_\-.]/g, '')
    const sensitive = /password|passwd|passphrase|secret|token|authorization|cookie|privatekey|accesskey|apikey|credentialpayload/.test(compact)
    return [key.slice(0, 128), sensitive ? '[已隐藏]' : bodyFields.has(key.toLowerCase()) ? '[内容已省略]' : scrub(item, depth + 1, budget)]
  }))
}

function projectAuditValue(value: Record<string, unknown>): Record<string, unknown> {
  const budget = { nodes: 256, bytes: 12 * 1024, truncated: false }
  const result = scrub(value, 0, budget)
  if (!isRecord(result)) return { _truncated: true }
  if (budget.truncated) result._truncated = true
  // JSON 转义与键名同样占用空间，最终再约束一次序列化大小。
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16 * 1024) return { _truncated: true }
  return result
}

export function auditParameters(value: unknown, toolName = ''): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const selected = Object.fromEntries(Object.entries(value).filter(([key]) => parameterFields.has(key)))
  const command = toolName === 'termous.commands.dispatch' && typeof selected.command === 'string'
    && Buffer.byteLength(selected.command, 'utf8') <= 8 * 1024 ? selected.command : undefined
  // 命令原文是执行证据，单独保留；其余字段继续使用统一脱敏和容量限制。
  if (command !== undefined) delete selected.command
  const result = projectAuditValue(selected)
  if (command !== undefined) result.command = command
  return result
}

export function auditResult(value: unknown, depth = 0, budget = { nodes: 256 }): Record<string, unknown> {
  if (!isRecord(value)) return {}
  if (--budget.nodes < 0 || depth > 6) return { _truncated: true }
  const selected = Object.fromEntries(Object.entries(value).filter(([key]) => resultFields.has(key)).map(([key, item]) => [
    key, isRecord(item) ? auditResult(item, depth + 1, budget) : Array.isArray(item) ? '[内容已省略]' : item,
  ]))
  return projectAuditValue(selected)
}

export function auditOutcome(value: Record<string, unknown>): string {
  const failure = isRecord(value.error) ? value.error : null
  const code = String(failure?.code ?? value.error_code ?? '').toUpperCase()
  if (code.includes('UNCERTAIN') || (typeof value.unknown_targets === 'number' && value.unknown_targets > 0)) return 'unknown'
  const state = [value.status, value.state, value.phase, value.outcome].find((item) => typeof item === 'string' && item !== '')
  let outcome: string | undefined
  if (typeof state === 'string') {
    const normalized = state.toLowerCase()
    if (['accepted', 'queued', 'pending', 'running', 'connecting', 'dispatching', 'enqueued', 'verifying', 'validating', 'interrupting', 'waiting_host_trust'].includes(normalized)) outcome = 'accepted'
    if (['cancelled', 'canceled', 'interrupted'].includes(normalized)) outcome = 'cancelled'
    if (['failed', 'disconnected', 'error', 'dispatch_conflict'].includes(normalized)) outcome = 'failed'
    if (['partial_failed', 'partial'].includes(normalized)) outcome = 'partial'
    if (['unknown', 'uncertain', 'completed_unknown'].includes(normalized)) outcome = 'unknown'
    if (['rejected', 'denied'].includes(normalized)) outcome = 'denied'
    if (normalized === 'expired') outcome = 'expired'
  }
  if (outcome === 'unknown' || (outcome === 'accepted' && !failure && !code)) return outcome
  if (value.partial === true) return 'partial'
  if (failure || code) {
    if (/CANCELLED|CANCELED|INTERRUPTED/.test(code)) return 'cancelled'
    if (code.includes('EXPIRED')) return 'expired'
    if (/REJECTED|FORBIDDEN|DENIED/.test(code)) return 'denied'
    return 'failed'
  }
  if (outcome) return outcome
  for (const key of ['task', 'operation', 'transfer', 'approval', 'session', 'result']) {
    if (isRecord(value[key])) return auditOutcome(value[key])
  }
  if (state === undefined && value._truncated === true) return 'unknown'
  return 'succeeded'
}
