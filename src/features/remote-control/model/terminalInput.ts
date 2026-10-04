// 确认丢失时冻结输入；重读状态只能确认已接受的序号，不能自动重放字节。
export class TerminalInput {
  private generation = 0n
  private accepted = 0n
  private pending?: bigint
  private queue = new Uint8Array(0)
  private timer?: ReturnType<typeof setTimeout>
  private enabled = false
  private frozen = false
  private revision = 0
  private write: (data: Uint8Array, generation: bigint, sequence: bigint) => Promise<void>
  private changed: (uncertain: boolean) => void
  constructor(write: (data: Uint8Array, generation: bigint, sequence: bigint) => Promise<void>, changed: (uncertain: boolean) => void) { this.write = write; this.changed = changed }

  update(generation: bigint, accepted: bigint, enabled: boolean, uncertain = false) {
    if (this.generation !== generation || !enabled) {
      this.clear()
      this.generation = generation
      this.accepted = accepted
      this.frozen = uncertain
    } else if (this.pending !== undefined && accepted >= this.pending) {
      this.clear()
      this.accepted = accepted
      this.frozen = uncertain
    } else if (this.pending === undefined) {
      this.accepted = accepted
      this.frozen = uncertain
    }
    this.enabled = enabled
    this.changed(this.frozen)
  }
  push(data: Uint8Array) {
    if (!this.enabled || this.frozen || !data.length) return
    if (this.queue.length + data.length > 16384) { this.freeze(); return }
    const next = new Uint8Array(this.queue.length + data.length)
    next.set(this.queue); next.set(data, this.queue.length); this.queue = next
    this.flush()
  }
  acknowledge(generation: bigint, sequence: bigint) {
    if (generation !== this.generation || this.pending !== sequence) return
    clearTimeout(this.timer)
    this.pending = undefined
    this.accepted = sequence
    if (!this.frozen) this.flush()
  }
  freeze() { this.frozen = true; this.queue = new Uint8Array(0); this.changed(true) }
  private flush() {
    if (this.pending !== undefined || this.frozen || !this.enabled || !this.queue.length) return
    const data = this.queue
    this.queue = new Uint8Array(0)
    const sequence = this.accepted + 1n
    const revision = this.revision
    this.pending = sequence
    // 换代次、确认或释放后，旧发送的迟到失败不能冻结后续输入。
    const failed = () => { if (this.enabled && this.revision === revision && this.pending === sequence) this.freeze() }
    this.timer = setTimeout(failed, 5000)
    void this.write(data, this.generation, sequence).catch(failed)
  }
  private clear() { this.revision++; clearTimeout(this.timer); this.pending = undefined; this.queue = new Uint8Array(0) }
  dispose() { this.clear(); this.enabled = false }
}
