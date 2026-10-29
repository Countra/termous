import type { IntegrationRuntimePort } from '../contracts/integrationIPC.ts'
import { integrationErrorCode, isIntegrationOperation } from '../contracts/integrationIPC.ts'
import { isRecord, validClientRequestID } from '../contracts/validation.ts'

export class IntegrationRunRelay {
  private readonly pending = new Map<string, AbortController>()
  private readonly port: IntegrationRuntimePort
  private readonly identity: { run_id: string; generation: number; session_id: string }
  private readonly send: (message: unknown) => void
  private closed = false
  constructor(port: IntegrationRuntimePort, identity: { run_id: string; generation: number; session_id: string }, send: (message: unknown) => void) {
    this.port = port; this.identity = identity; this.send = send
  }

  handle(value: unknown) {
    if (!isRecord(value) || !['integration_request', 'integration_cancel'].includes(String(value.type))) return false
    if (this.closed || value.run_id !== this.identity.run_id || value.generation !== this.identity.generation || !validClientRequestID(value.request_id)) return true
    const id = value.request_id
    if (value.type === 'integration_cancel') { this.pending.get(id)?.abort(); return true }
    if (this.pending.has(id)) return true
    if (typeof value.bearer !== 'string' || value.bearer.length < 40 || value.bearer.length > 256 || !isIntegrationOperation(value.operation)) return true
    if (this.pending.size >= 32 || Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) {
      this.respond(id, undefined, 'INTEGRATION_QUEUE_FULL'); return true
    }
    const abort = new AbortController()
    this.pending.set(id, abort)
    // Run 身份来自 Supervisor 拥有的 Worker，消息只能携带该 Run 的临时 bearer。
    void this.port.request({ ...this.identity, bearer: value.bearer }, value.operation, abort.signal)
      .then(result => this.respond(id, result), error => this.respond(id, undefined, integrationErrorCode(error)))
      .finally(() => this.pending.delete(id))
    return true
  }
  close() {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) request.abort()
    this.pending.clear()
    this.port.release(this.identity.run_id)
  }
  private respond(id: string, value?: unknown, error?: string) {
    if (!this.closed) this.send({ type: 'integration_response', ...this.identity, request_id: id, ...(error ? { error } : { value }) })
  }
}
