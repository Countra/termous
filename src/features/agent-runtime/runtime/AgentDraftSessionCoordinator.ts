import type { AgentSession } from '#entities/agent'

export class AgentDraftSessionCoordinator {
  private pending?: {
    generation: number
    promise: Promise<AgentSession>
    consumers: number
    settled: boolean
  }

  current(generation: number) {
    return this.pending?.generation === generation ? this.pending.promise : undefined
  }

  /** 为旁路复用者取得一个需要配对释放的引用。 */
  acquire(generation: number) {
    const pending = this.pending
    if (!pending || pending.generation !== generation) return undefined
    pending.consumers += 1
    return pending.promise
  }

  ensure(generation: number, create: () => Promise<AgentSession>) {
    if (this.pending?.generation === generation) {
      this.pending.consumers += 1
      return this.pending.promise
    }
    let promise: Promise<AgentSession>
    try {
      promise = Promise.resolve(create())
    } catch (error) {
      promise = Promise.reject(error)
    }
    const pending = { generation, promise, consumers: 1, settled: false }
    this.pending = pending
    void promise.then(
      () => {
        pending.settled = true
        this.releaseSettled(pending)
      },
      () => {
        pending.settled = true
        // 失败不会留下可复用会话；等待中的调用者仍会收到同一个拒绝。
        if (this.pending === pending) this.pending = undefined
      },
    )
    return promise
  }

  release(pending: Promise<AgentSession>) {
    const current = this.pending
    if (!current || current.promise !== pending || current.consumers === 0) return
    current.consumers -= 1
    this.releaseSettled(current)
  }

  private releaseSettled(pending: NonNullable<AgentDraftSessionCoordinator['pending']>) {
    if (pending.settled && pending.consumers === 0 && this.pending === pending) {
      this.pending = undefined
    }
  }
}
