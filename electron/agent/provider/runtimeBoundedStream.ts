import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'

// 字节预算只计算队列独占的增量；partial 是共享快照，不能逐事件重复计费。
export class RuntimeBoundedStream extends AssistantMessageEventStream {
  private readonly sizes: number[] = []
  private pendingBytes = 0
  private consuming = false
  private stopped = false
  private readonly waiters = new Set<() => void>()

  override push(event: AssistantMessageEvent) {
    if (this.stopped) {
      if (event.type === 'done' || event.type === 'error') super.end(event.type === 'done' ? event.message : event.error)
      return
    }
    const size = 'delta' in event && typeof event.delta === 'string' ? Buffer.byteLength(event.delta) : 128
    this.sizes.push(size)
    this.pendingBytes += size
    super.push(event)
  }

  async waitForCapacity(signal?: AbortSignal) {
    while (this.sizes.length >= 64 || this.pendingBytes >= 1024 * 1024) {
      signal?.throwIfAborted()
      if (this.stopped) throw new Error('AGENT_MODEL_STREAM_CONSUMER_CLOSED')
      await new Promise<void>((resolve, reject) => {
        const finish = () => { this.waiters.delete(finish); signal?.removeEventListener('abort', abort); resolve() }
        const abort = () => { this.waiters.delete(finish); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
        this.waiters.add(finish)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })
    }
    signal?.throwIfAborted()
    if (this.stopped) throw new Error('AGENT_MODEL_STREAM_CONSUMER_CLOSED')
  }

  override async result() {
    // 同一调用栈可同时订阅终态和迭代事件，先让显式迭代器取得消费权。
    await Promise.resolve()
    // 摘要调用只读取 result，也必须消费内部队列，不能让背压死锁。
    if (!this.consuming) {
      for await (const event of this) { if (event.type === 'done' || event.type === 'error') break }
    }
    return super.result()
  }

  override async *[Symbol.asyncIterator]() {
    if (this.consuming) throw new Error('AGENT_MODEL_STREAM_CONSUMER_DUPLICATED')
    this.consuming = true
    const iterator = super[Symbol.asyncIterator]()
    try {
      for (;;) {
        const step = await iterator.next()
        if (step.done) break
        yield step.value
        this.pendingBytes -= this.sizes.shift() ?? 0
        for (const notify of this.waiters) notify()
      }
    } finally {
      this.stopped = true
      this.sizes.length = 0
      this.pendingBytes = 0
      for (const notify of this.waiters) notify()
      // SDK 队列没有公开 clear；结束生产后排空最多一个窗口的遗留事件。
      super.end()
      while (!(await iterator.next()).done) { /* 释放已缓冲的快照引用。 */ }
      await iterator.return?.()
    }
  }
}
