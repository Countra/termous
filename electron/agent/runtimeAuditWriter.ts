import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { isRecord } from './protocol.ts'
import { isMCPToolDetails } from './mcpClientAdapter.ts'
import { auditOutcome, auditParameters, auditResult } from './auditProjection.ts'

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

interface Options {
  submit(events: RuntimeAuditEvent[], signal: AbortSignal): Promise<void>
  originalName(name: string): string | null
  isCancelled?: () => boolean
  warn?: (dropped: number) => void
  flushDelayMs?: number
}

interface Pending { event: RuntimeAuditEvent; bytes: number }

// 审计失败仅影响记录完整性，不进入业务事件 writer 的失败和终止流程。
export class RuntimeAuditWriter {
  private readonly pending: Pending[] = []
  private readonly started = new Map<string, number>()
  private readonly abort = new AbortController()
  private bytes = 0
  private accepting = true
  private timer: ReturnType<typeof setTimeout> | null = null
  private active: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private dropped = 0
  private lastWarning = 0

  private readonly options: Options

  constructor(options: Options) { this.options = options }

  capture(event: AgentEvent) {
    if (!this.accepting || (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_end')) return
    try {
      const now = Date.now()
      const original = this.options.originalName(event.toolName)
      const name = original ?? event.toolName
      if (event.type === 'tool_execution_start') {
        if (this.started.size >= 512) this.started.delete(this.started.keys().next().value ?? '')
        this.started.set(event.toolCallId, now)
        this.push({ id: `audit_${randomUUID()}`, tool_call_id: event.toolCallId, tool_name: name, phase: 'start', outcome: 'started', occurred_at: new Date(now).toISOString(), duration_ms: 0, parameters: original ? auditParameters(event.args, original) : {} })
      } else {
        const start = this.started.get(event.toolCallId) ?? now
        this.started.delete(event.toolCallId)
        const result = isMCPToolDetails(event.result.details)
          ? auditResult(event.result.details.result.structuredContent)
          : isRecord(event.result.details) ? auditResult(event.result.details) : {}
        // Pi 的异常文本可能包含完整原始参数，只保留稳定错误摘要。
        if (event.isError && !result.error) result.error = { code: 'AGENT_TOOL_FAILED', message: '工具未成功执行' }
        const outcome = event.isError && this.options.isCancelled?.() ? 'cancelled' : auditOutcome(result)
        this.push({ id: `audit_${randomUUID()}`, tool_call_id: event.toolCallId, tool_name: name, phase: 'end', outcome, occurred_at: new Date(now).toISOString(), duration_ms: Math.max(0, now - start), result })
      }
    } catch {
      this.drop(1)
    }
  }

  push(event: RuntimeAuditEvent) {
    if (!this.accepting) return
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (bytes > 80 * 1024 || this.pending.length >= 512 || this.bytes + bytes > 4 * 1024 * 1024) { this.drop(1); return }
    this.pending.push({ event, bytes })
    this.bytes += bytes
    if (this.pending.length >= 32) void this.flush()
    else this.schedule()
  }

  private schedule() {
    if (this.timer || !this.accepting || this.pending.length === 0) return
    this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.options.flushDelayMs ?? 250)
    this.timer.unref?.()
  }

  flush(): Promise<void> {
    if (this.active) return this.active
    this.active = this.drain().catch(() => { this.drop(this.pending.length); this.pending.length = 0; this.bytes = 0 })
      .finally(() => { this.active = null; this.schedule() })
    return this.active
  }

  private async drain() {
    while (this.pending.length && !this.abort.signal.aborted) {
      const batch: RuntimeAuditEvent[] = []
      let bytes = 256
      while (this.pending.length && batch.length < 32) {
        const next = this.pending[0]!
        if (bytes + next.bytes > 512 * 1024) break
        this.pending.shift()
        this.bytes -= next.bytes
        bytes += next.bytes + 1
        batch.push(next.event)
      }
      let sent = false
      for (let attempt = 0; attempt < 3 && !this.abort.signal.aborted; attempt++) {
        try { await this.options.submit(batch, this.abort.signal); sent = true; break }
        catch (error) {
          if (isRecord(error) && typeof error.status === 'number' && [400, 401, 403, 404, 409, 413].includes(error.status)) break
          if (attempt < 2) await delay((attempt + 1) * 250, this.abort.signal)
        }
      }
      if (!sent) this.drop(batch.length)
    }
  }

  close(): Promise<void> {
    this.closing ??= this.finishClose()
    return this.closing
  }

  private async finishClose() {
    this.accepting = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.flush(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 2_000) })])
    } finally {
      if (timer) clearTimeout(timer)
      this.abort.abort()
      this.drop(this.pending.length)
      this.pending.length = 0
      this.bytes = 0
      this.started.clear()
    }
  }

  private drop(count: number) {
    if (count === 0) return
    this.dropped += count
    if (Date.now() - this.lastWarning < 30_000) return
    this.lastWarning = Date.now()
    try { (this.options.warn ?? ((dropped) => console.warn('Agent audit records dropped', { dropped })))(this.dropped) } catch { /* 诊断回调不能影响工具执行。 */ }
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}
