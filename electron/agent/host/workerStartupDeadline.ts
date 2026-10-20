type StartupStage = 'spawn' | 'bootstrap'

export class WorkerStartupDeadline {
  private stage: StartupStage | null = null
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onTimeout: (stage: StartupStage, errorCode: string) => void
  private readonly schedule: typeof globalThis.setTimeout
  private readonly cancel: typeof globalThis.clearTimeout

  constructor(
    onTimeout: (stage: StartupStage, errorCode: string) => void,
    schedule: typeof globalThis.setTimeout,
    cancel: typeof globalThis.clearTimeout,
  ) {
    this.onTimeout = onTimeout
    this.schedule = schedule
    this.cancel = cancel
  }

  observe() {
    if (!this.closed && this.stage === null) this.arm('spawn', 10_000)
  }

  spawned() {
    if (this.closed || this.stage !== 'spawn') return false
    // 覆盖 Ticket、Core 大响应、MCP 连接与工具发现的串行预算；不限制模型推理时长。
    this.arm('bootstrap', 120_000)
    return true
  }

  complete() {
    this.closed = true
    this.clear()
  }

  private arm(stage: StartupStage, timeoutMs: number) {
    this.clear()
    this.stage = stage
    this.timer = this.schedule(() => {
      this.complete()
      this.onTimeout(stage, stage === 'spawn'
        ? 'AGENT_RUNTIME_WORKER_SPAWN_TIMEOUT'
        : 'AGENT_RUNTIME_WORKER_START_TIMEOUT')
    }, timeoutMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref()
  }

  private clear() {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
  }
}
