// 渲染回执与网络额度分别收口，关闭视图时不能遗留等待 xterm 回调的消息。
export class TerminalOutput {
  private pending = new Set<() => void>()
  private credit = 0
  private sending = false
  private stopped = false
  private render: (data: Uint8Array, done: () => void) => void
  private grant: (bytes: number) => Promise<void>
  private failed: (error: unknown) => void

  constructor(
    render: (data: Uint8Array, done: () => void) => void,
    grant: (bytes: number) => Promise<void>,
    failed: (error: unknown) => void,
  ) { this.render = render; this.grant = grant; this.failed = failed }

  async start() {
    if (this.stopped) return false
    this.credit += 65536
    await this.flush()
    return !this.stopped
  }

  consume(data: Uint8Array): Promise<void> {
    if (this.stopped) return Promise.resolve()
    return new Promise(resolve => {
      const finish = () => {
        if (!this.pending.delete(finish)) return
        if (!this.stopped && data.length) {
          this.credit += data.length
          void this.flush()
        }
        resolve()
      }
      this.pending.add(finish)
      try { this.render(data, finish) } catch (error) { this.fail(error) }
    })
  }

  private async flush() {
    if (this.sending || this.stopped) return
    this.sending = true
    try {
      while (!this.stopped && this.credit) {
        const bytes = this.credit
        this.credit = 0
        await this.grant(bytes)
      }
    } catch (error) {
      // 发送结果不明不能重复授予额度，错误仅结束所属终端附着。
      this.fail(error)
    } finally { this.sending = false }
  }

  private fail(error: unknown) {
    if (this.stopped) return
    this.dispose()
    this.failed(error)
  }

  dispose() {
    this.stopped = true
    this.credit = 0
    for (const finish of this.pending) finish()
  }
}
