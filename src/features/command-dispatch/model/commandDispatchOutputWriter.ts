import type { CommandDispatchOutputSnapshot } from './commandDispatchOutputStore.ts'
import {
  createCommandDispatchOutputRenderCursor,
  planCommandDispatchOutputRender,
} from './commandDispatchOutputRender.ts'

export interface CommandDispatchOutputTerminal {
  reset(): void
  scrollToBottom(): void
  write(data: Uint8Array, callback: () => void): void
}

/**
 * 串行提交 xterm 写入，避免 reset 与尚未解析的旧 write 队列交错。
 * 写入繁忙时只保留最新累计快照，下一轮通过 render plan 自动补齐或完整重放。
 */
export class CommandDispatchOutputWriter {
  private readonly terminal: CommandDispatchOutputTerminal
  private cursor = createCommandDispatchOutputRenderCursor()
  private latest: CommandDispatchOutputSnapshot | null = null
  private writing = false
  private disposed = false

  constructor(terminal: CommandDispatchOutputTerminal) {
    this.terminal = terminal
  }

  update(output: CommandDispatchOutputSnapshot) {
    if (this.disposed) return
    this.latest = output
    this.drain()
  }

  dispose() {
    this.disposed = true
    this.latest = null
  }

  private drain() {
    if (this.disposed || this.writing || !this.latest) return

    const output = this.latest
    this.latest = null
    const plan = planCommandDispatchOutputRender(this.cursor, output)
    this.cursor = plan.cursor
    if (plan.mode === 'none') {
      this.drain()
      return
    }
    if (plan.mode === 'reset') {
      this.terminal.reset()
    }
    if (plan.data.byteLength === 0) {
      this.terminal.scrollToBottom()
      this.drain()
      return
    }

    this.writing = true
    this.terminal.write(plan.data, () => {
      if (this.disposed) return
      this.writing = false
      this.terminal.scrollToBottom()
      this.drain()
    })
  }
}
