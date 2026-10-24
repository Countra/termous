interface ImageRead {
  controller: AbortController
  clients: Set<symbol>
  promise: Promise<Blob>
}

// 仅合并当前使用者持有的读取；最后一个使用者离开时取消并释放结果，不建立常驻原图缓存。
export class AgentImageRequests {
  private readonly entries = new Map<string, ImageRead>()
  private active = 0
  private readonly wake = new Set<() => void>()

  read(key: string, load: (signal: AbortSignal) => Promise<Blob>, signal?: AbortSignal): Promise<Blob> {
    signal?.throwIfAborted()
    let entry = this.entries.get(key)
    if (!entry) {
      const controller = new AbortController()
      entry = { controller, clients: new Set(), promise: this.execute(load, controller.signal) }
      this.entries.set(key, entry)
    }
    const current = entry
    const client = Symbol()
    current.clients.add(client)
    return new Promise<Blob>((resolve, reject) => {
      const release = () => {
        signal?.removeEventListener('abort', abort)
        current.clients.delete(client)
        if (current.clients.size === 0) {
          current.controller.abort()
          if (this.entries.get(key) === current) this.entries.delete(key)
        }
      }
      const abort = () => { release(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')) }
      signal?.addEventListener('abort', abort, { once: true })
      current.promise.then(blob => {
        if (signal?.aborted) { abort(); return }
        resolve(blob)
        if (!signal) release()
      }, error => { release(); reject(error) })
      if (signal?.aborted) abort()
    })
  }

  private async execute(load: (signal: AbortSignal) => Promise<Blob>, signal: AbortSignal) {
    while (this.active >= 2) {
      await new Promise<void>((resolve, reject) => {
        const done = () => { this.wake.delete(done); signal.removeEventListener('abort', abort); resolve() }
        const abort = () => { this.wake.delete(done); signal.removeEventListener('abort', abort); reject(signal.reason) }
        this.wake.add(done)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
    signal.throwIfAborted()
    this.active++
    try {
      const blob = await load(signal)
      signal.throwIfAborted()
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('AGENT_IMAGE_INVALID')
      return blob
    } finally {
      this.active--
      for (const done of this.wake) done()
    }
  }
}
