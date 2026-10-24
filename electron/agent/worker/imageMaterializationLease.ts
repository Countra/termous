import { randomUUID } from 'node:crypto'

export class ImageMaterializationLease {
  private readonly pending = new Map<string, () => void>()
  private readonly failures = new Map<string, (error: unknown) => void>()
  private readonly send: (id: string, bytes: number, action: 'acquire' | 'release') => void
  constructor(send: (id: string, bytes: number, action: 'acquire' | 'release') => void) { this.send = send }

  granted(id: string) { this.pending.get(id)?.() }
  rejected(id: string) { this.failures.get(id)?.(new Error('AGENT_IMAGE_BUDGET_UNAVAILABLE')) }

  async acquire(bytes: number, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('AGENT_IMAGE_BUDGET_INVALID')
    const id = `agimg_${randomUUID()}`
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.pending.delete(id)
      this.failures.delete(id)
      this.send(id, bytes, 'release')
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: unknown) => { this.pending.delete(id); this.failures.delete(id); signal?.removeEventListener('abort', abort); reject(error) }
        const abort = () => fail(signal?.reason)
        this.failures.set(id, fail)
        this.pending.set(id, () => { this.pending.delete(id); this.failures.delete(id); signal?.removeEventListener('abort', abort); resolve() })
        signal?.addEventListener('abort', abort, { once: true })
        try { this.send(id, bytes, 'acquire') } catch (error) { signal?.removeEventListener('abort', abort); reject(error) }
        if (signal?.aborted) abort()
      })
      signal?.throwIfAborted()
      return release
    } catch (error) { release(); throw error }
  }
}
