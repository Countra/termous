export interface DetachedStateFrame {
  sequence: number
  full: boolean
  partitions: Record<string, unknown>
}

export class DetachedStatePublisher {
  private sequence = 0
  private values: Record<string, unknown> = {}
  private signatures = new Map<string, string>()

  update(partitions: Record<string, unknown>): DetachedStateFrame | undefined {
    const changes: Record<string, unknown> = {}
    const signatures = new Map<string, string>()
    for (const key of new Set([...Object.keys(this.values), ...Object.keys(partitions)])) {
      const value = partitions[key] ?? null
      const signature = JSON.stringify(value)
      if (Object.prototype.hasOwnProperty.call(partitions, key)) signatures.set(key, signature)
      if (signature === this.signatures.get(key)) continue
      changes[key] = value
    }
    this.signatures = signatures
    this.values = partitions
    if (!Object.keys(changes).length) return
    return { sequence: ++this.sequence, full: false, partitions: changes }
  }

  snapshot(): DetachedStateFrame { return { sequence: this.sequence, full: true, partitions: this.values } }

  clear() { this.values = {}; this.signatures.clear() }
}

export class DetachedStateReceiver {
  private sequence = -1
  private values: Record<string, unknown> = {}
  private buffered: DetachedStateFrame[] = []

  accept(frame: DetachedStateFrame): 'applied' | 'ignored' | 'gap' {
    if (!frame || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || typeof frame.full !== 'boolean'
      || typeof frame.partitions !== 'object' || !frame.partitions || Array.isArray(frame.partitions)) return 'gap'
    if (frame.sequence < this.sequence || frame.sequence === this.sequence && !frame.full) return 'ignored'
    if (!frame.full && (this.sequence < 0 || frame.sequence !== this.sequence + 1)) {
      if (this.buffered.length < 128) this.buffered.push(frame)
      return 'gap'
    }
    this.values = frame.full ? { ...frame.partitions } : { ...this.values, ...frame.partitions }
    for (const [key, value] of Object.entries(this.values)) if (value === null) delete this.values[key]
    this.sequence = frame.sequence
    if (frame.full) {
      const buffered = this.buffered.sort((a, b) => a.sequence - b.sequence)
      this.buffered = []
      // 断档后的帧仍须全部重新入队，不能因首个缺口丢失后续更新。
      for (const update of buffered) this.accept(update)
      if (this.buffered.length) return 'gap'
    }
    return 'applied'
  }

  snapshot() { return this.values }
}
