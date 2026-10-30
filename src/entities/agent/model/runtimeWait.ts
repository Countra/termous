import type { AgentToolCallPart, AgentToolResultPart } from './types.ts'

export interface AgentRuntimeWait {
  seconds: number
  reason?: string
  elapsedMs?: number
  wakeReason?: 'elapsed' | 'steer' | 'task_update'
  startedAt?: string
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function readRuntimeWait(call?: AgentToolCallPart, result?: AgentToolResultPart): AgentRuntimeWait | undefined {
  if ((call?.tool_name ?? result?.tool_name) !== 'wait') return undefined
  const args = record(call?.arguments) ? call.arguments : {}
  let data: Record<string, unknown> = {}
  if (result?.tool_name === 'wait' && !result.is_error && Array.isArray(result.content)) {
    const block = result.content.find(value => record(value) && value.type === 'text')
    if (record(block) && typeof block.text === 'string' && block.text.length < 2048) {
      try { const parsed: unknown = JSON.parse(block.text); if (record(parsed) && parsed.kind === 'runtime_wait') data = parsed } catch { /* 旧版或异常回执仍可查看原始详情。 */ }
    }
  }
  const seconds = args.duration_seconds ?? data.requested_seconds
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 60) return undefined
  return { seconds, reason: typeof args.reason === 'string' ? args.reason.slice(0, 256) : undefined,
    elapsedMs: typeof data.elapsed_ms === 'number' && Number.isSafeInteger(data.elapsed_ms) && data.elapsed_ms >= 0 ? data.elapsed_ms : undefined,
    wakeReason: data.wake_reason === 'elapsed' || data.wake_reason === 'steer' || data.wake_reason === 'task_update' ? data.wake_reason : undefined }
}
