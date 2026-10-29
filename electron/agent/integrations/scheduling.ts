interface Waiting {
  bytes: number
  start(): void
  reject(error: Error): void
  dispose(): void
}

// 审批在进入执行队列前完成；取消直接移除等待项，不占用执行名额。
export class IntegrationScheduler {
  private active = 0
  private queuedBytes = 0
  private readonly queue: Waiting[] = []
  private closed = false
  private idle?:Promise<void>
  private resolveIdle?:()=>void

  private readonly capacity: number
  private readonly maxQueued: number
  private readonly maxBytes: number
  constructor(capacity: number, maxQueued = 64, maxBytes = 2 * 1024 * 1024) {
    this.capacity = capacity
    this.maxQueued = maxQueued
    this.maxBytes = maxBytes
  }

  async run<T>(bytes: number, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) throw new Error('INTEGRATION_QUEUE_BYTES_EXCEEDED')
    if (this.closed) throw new Error('INTEGRATION_HOST_CLOSED')
    signal?.throwIfAborted()
    if (this.active < this.capacity) this.active++
    else await new Promise<void>((resolve, reject) => {
      if (this.queue.length >= this.maxQueued || this.queuedBytes + bytes > this.maxBytes) { reject(new Error('INTEGRATION_QUEUE_FULL')); return }
      const abort = () => {
        const index = this.queue.indexOf(entry)
        if (index < 0) return
        this.queue.splice(index, 1)
        this.queuedBytes -= bytes
        entry.dispose()
        reject(new DOMException('请求已取消', 'AbortError'))
      }
      const entry: Waiting = { bytes, start: resolve, reject, dispose: () => signal?.removeEventListener('abort', abort) }
      this.queue.push(entry)
      this.queuedBytes += bytes
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    try { signal?.throwIfAborted(); return await operation() }
    finally {
      const next = this.queue.shift()
      if (next) { this.queuedBytes -= next.bytes; next.dispose(); next.start() }
      else {
        this.active--
        if (!this.active) {this.resolveIdle?.();this.resolveIdle=undefined;this.idle=undefined}
      }
    }
  }

  close() {
    this.closed = true
    for (const entry of this.queue.splice(0)) { entry.dispose(); entry.reject(new Error('INTEGRATION_HOST_CLOSED')) }
    this.queuedBytes = 0
  }

  usage() { return { active: this.active, queued: this.queue.length, bytes: this.queuedBytes } }
  whenIdle() {
    if (!this.active) return Promise.resolve()
    this.idle ??= new Promise<void>(resolve=>{this.resolveIdle=resolve})
    return this.idle
  }
}
