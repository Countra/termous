interface Reservation { owner: string; id: string; bytes: number; grant: () => void; reject?: (error: unknown) => void }

// 按预计编码字节串行准入；较大的合法单请求独占预算，不改变逻辑 Run 并发配置。
export class ImageMaterializationBudget {
  private used = 0
  private readonly active = new Map<string, Reservation>()
  private readonly pending: Reservation[] = []
  private readonly limit: number
  constructor(limit = 256 * 1024 * 1024) { this.limit = limit }

  acquire(value: Reservation) {
    if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new Error('AGENT_IMAGE_BUDGET_INVALID')
    const key = `${value.owner}:${value.id}`
    if (this.active.has(key) || this.pending.some(item => item.owner === value.owner && item.id === value.id)) return
    // 每个串行 Worker 同时只允许一个物化请求，避免异常消息淹没主进程等待队列。
    if ([...this.active.values(), ...this.pending].some(item => item.owner === value.owner) || this.pending.length >= 32) {
      throw new Error('AGENT_IMAGE_BUDGET_PENDING')
    }
    this.pending.push(value)
    this.drain()
  }

  release(owner: string, id?: string) {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      if (this.pending[index]!.owner === owner && (!id || this.pending[index]!.id === id)) this.pending.splice(index, 1)
    }
    for (const [key, value] of this.active) {
      if (value.owner === owner && (!id || value.id === id)) { this.used -= value.bytes; this.active.delete(key) }
    }
    this.drain()
  }

  private drain() {
    while (this.pending.length) {
      const value = this.pending[0]!
      if (this.used && this.used + value.bytes > this.limit) return
      this.pending.shift()
      const key = `${value.owner}:${value.id}`
      this.active.set(key, value)
      this.used += value.bytes
      try { value.grant() } catch (error) {
        this.active.delete(key); this.used -= value.bytes
        if (!value.reject) throw error
        value.reject(error)
      }
    }
  }
}

export const imageMaterializationBudget = new ImageMaterializationBudget()
