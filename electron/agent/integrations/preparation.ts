import type { IntegrationPreparationSource } from '../contracts/integrations.ts'

interface Preparation {
  session: string
  controller: AbortController
  sources: Map<string, { fingerprint: string; controller: AbortController; done: Promise<void> }>
  syncing?: Promise<void>
  done: Promise<void>
}

interface PreparationOptions {
    sources(session: string, signal: AbortSignal): Promise<IntegrationPreparationSource[]>
    open(source: IntegrationPreparationSource, session: string, owner: string, signal: AbortSignal): Promise<void>
    release(owner: string, source?: string): void
    failed(error: unknown): void
}

// 页面和 Run 各自持有连接引用；配置变化才重建，失败来源不循环启动。
export class IntegrationPreparation {
  private readonly owners = new Map<string, Preparation>()
  private readonly options: PreparationOptions
  constructor(options: PreparationOptions) { this.options = options }

  async refresh(session: string, owner: string) {
    let entry = this.owners.get(owner)
    if (entry && entry.session !== session) { this.release(owner); entry = undefined }
    if (!entry) {
      if (this.owners.size >= 64) throw new Error('INTEGRATION_PREPARATION_CAPACITY')
      entry = { session, controller: new AbortController(), sources: new Map(), done: Promise.resolve() }
      this.owners.set(owner, entry)
    }
    if (entry.syncing) return entry.syncing
    const current = entry
    current.syncing = this.options.sources(session, current.controller.signal).then(sources => {
      current.controller.signal.throwIfAborted()
      const allowed = new Set(sources.map(value => value.source.id))
      for (const [id, previous] of current.sources) {
        if (allowed.has(id)) continue
        previous.controller.abort(); current.sources.delete(id); this.options.release(owner, id)
      }
      for (const source of sources) {
        const id = source.source.id
        const fingerprint = JSON.stringify(source)
        const previous = current.sources.get(id)
        if (previous?.fingerprint === fingerprint) continue
        // 单个来源变化不能重新启动其他失败来源，也不能打断其他来源的初始化。
        previous?.controller.abort(); this.options.release(owner, id)
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, current.controller.signal])
        const done = this.options.open(source, session, owner, signal).catch(error => {
          if (!signal.aborted) this.options.failed(error)
        })
        current.sources.set(id, { fingerprint, controller, done })
      }
      current.done = Promise.all([...current.sources.values()].map(value => value.done)).then(() => undefined)
    }).catch(error => { if (!current.controller.signal.aborted) this.options.failed(error) })
      .finally(() => { current.syncing = undefined })
    return current.syncing
  }

  async start(session: string, owner: string) {
    await this.refresh(session, owner)
    await this.owners.get(owner)?.done
  }

  async wait(session: string, owner: string, signal?: AbortSignal) {
    const pending = this.start(session, owner)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      await Promise.race([pending, new Promise<void>((resolve, reject) => {
        timer = setTimeout(resolve, 10_000)
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })])
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) }
  }

  release(owner: string) {
    const entry = this.owners.get(owner)
    entry?.controller.abort()
    this.owners.delete(owner); this.options.release(owner)
  }
  invalidate(source: string) {
    // 显式重新连接允许目标来源重新准备，不重试其他已失败来源。
    for (const [owner, entry] of this.owners) {
      entry.sources.get(source)?.controller.abort()
      entry.sources.delete(source)
      this.options.release(owner, source)
    }
  }
  close() { for (const owner of this.owners.keys()) this.release(owner) }
}
