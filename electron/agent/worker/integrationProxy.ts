import { randomUUID } from 'node:crypto'
import type { IntegrationOperation } from '../contracts/integrationIPC.ts'
import { isRecord } from '../contracts/validation.ts'

export class WorkerIntegrationProxy {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; dispose(): void }>()
  private readonly send: (message: unknown) => void
  private readonly context: { run_id: string; generation: number; bearer: string }
  private closed = false
  constructor(context: { run_id: string; generation: number; bearer: string }, send: (message: unknown) => void) { this.context = context; this.send = send }

  request<T>(operation: IntegrationOperation, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.closed) return Promise.reject(new Error('INTEGRATION_HOST_CLOSED'))
    if (this.pending.size >= 32) return Promise.reject(new Error('INTEGRATION_QUEUE_FULL'))
    const id = `ext_${randomUUID()}`
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.send({ type: 'integration_cancel', ...this.context, request_id: id })
        this.finish(id, undefined, new DOMException('请求已取消', 'AbortError'))
      }
      this.pending.set(id, { resolve: value => resolve(value as T), reject, dispose: () => signal?.removeEventListener('abort', abort) })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      try { this.send({ type: 'integration_request', ...this.context, request_id: id, operation }) }
      catch { this.finish(id, undefined, new Error('INTEGRATION_HOST_UNAVAILABLE')) }
    })
  }
  handle(value: unknown) {
    if (!isRecord(value) || value.type !== 'integration_response') return false
    if (value.run_id === this.context.run_id && value.generation === this.context.generation && typeof value.request_id === 'string') {
      this.finish(value.request_id, value.value, typeof value.error === 'string' ? new Error(value.error) : undefined)
    }
    return true
  }
  close() {
    this.closed = true
    for (const id of this.pending.keys()) {
      this.send({ type: 'integration_cancel', ...this.context, request_id: id })
      this.finish(id, undefined, new Error('INTEGRATION_HOST_CLOSED'))
    }
  }
  private finish(id: string, value?: unknown, error?: Error) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id); pending.dispose()
    if (error) pending.reject(error)
    else pending.resolve(value)
  }
}
