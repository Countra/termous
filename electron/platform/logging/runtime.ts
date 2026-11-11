import { createRecord, levelOrder, type LogLevel, type LogRecord } from './record.ts'
import { fileLogSink, stderrLogSink, type ProcessLogSink } from './sink.ts'

export type { LogLevel } from './record.ts'
const capacity = 1024, maxBytes = 1024 * 1024
const normalCapacity = capacity - 128, normalBytes = maxBytes - 128 * 1024
const levelCounts = () => ({ debug: 0, info: 0, warn: 0, error: 0 })
const outputCounts = () => ({ file: 0, stderr: 0 })
interface PendingRecord extends LogRecord { pending: number; writing: number }
interface OutputState {
  sink: ProcessLogSink
  mask: number
  retryAt: number
  busy: boolean
  dropped: ReturnType<typeof levelCounts>
  failures: ReturnType<typeof outputCounts>
  skipped: ReturnType<typeof outputCounts>
}

export class ProcessLogger {
  private readonly queue: PendingRecord[] = []
  private readonly sinks: OutputState[]
  private readonly outputMask: number
  private bytes = 0
  private scheduled = false
  private flushing?: Promise<boolean>
  private idle?: () => void

  constructor(sinks: ProcessLogSink[]) {
    if (!sinks.length || new Set(sinks.map(sink => sink.name)).size !== sinks.length) throw new Error('日志输出端必须非空且不重复')
    this.sinks = sinks.map((sink, index) => ({ sink, mask: 1 << index, retryAt: 0, busy: false, dropped: levelCounts(), failures: outputCounts(), skipped: outputCounts() }))
    this.outputMask = (1 << sinks.length) - 1
  }

  report(event: string, fields: Record<string, unknown>, level: LogLevel = 'info') {
    try {
      const record = createRecord(level, event, fields)
      const itemLimit = levelOrder[level] < 2 ? normalCapacity : capacity
      const byteLimit = levelOrder[level] < 2 ? normalBytes : maxBytes
      while (this.queue.length >= itemLimit || this.bytes + record.bytes > byteLimit) {
        // 先回收已由其他输出端消费的低等级副本；在途写入和更高等级记录不能被淘汰。
        let index = this.queue.findIndex(item => !item.writing && item.pending !== this.outputMask && levelOrder[item.level] <= levelOrder[level])
        if (index < 0 && levelOrder[level] >= 2) index = this.queue.findIndex(item => !item.writing && levelOrder[item.level] < levelOrder[level])
        if (index < 0) { this.drop(level); return }
        const [removed] = this.queue.splice(index, 1)
        this.bytes -= removed.bytes
        for (const state of this.sinks) {
          if (removed.pending & state.mask) { state.dropped[removed.level]++; this.skip(state, 1) }
        }
      }
      this.queue.push({ ...record, pending: this.outputMask, writing: 0 }); this.bytes += record.bytes
      this.schedule()
    } catch {
      // 不可序列化输入仅丢弃日志，不能使业务回调失败。
      this.drop(level)
    }
  }

  flush(timeoutMs = 2000): Promise<boolean> {
    if (this.flushing) return this.flushing
    if (this.isIdle()) return Promise.resolve(true)
    this.flushing = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => finish(false), Math.max(0, Math.min(2000, timeoutMs)))
      const finish = (complete: boolean) => {
        clearTimeout(timer); this.idle = undefined; resolve(complete)
      }
      this.idle = () => finish(true)
    }).finally(() => { this.flushing = undefined })
    this.schedule()
    return this.flushing
  }

  private isIdle() { return !this.scheduled && !this.queue.length && !this.sinks.some(state => state.busy || Object.values(state.dropped).some(Boolean)) }

  private drop(level: LogLevel) {
    for (const state of this.sinks) state.dropped[level]++
    this.schedule()
  }

  private skip(state: OutputState, count: number) {
    for (const output of this.sinks) output.skipped[state.sink.name] += count
  }

  private hasWork(state: OutputState) {
    return this.queue.some(record => record.pending & state.mask) || Object.values(state.dropped).some(Boolean)
  }

  private schedule() {
    if (this.scheduled || !this.sinks.some(state => !state.busy && this.hasWork(state))) return
    this.scheduled = true
    setImmediate(() => { this.scheduled = false; this.dispatch() })
  }

  private dispatch() {
    for (const state of this.sinks) {
      if (state.busy || !this.hasWork(state)) continue
      if (performance.now() < state.retryAt) {
        let skipped = 0
        for (const record of this.queue) {
          if (record.pending & state.mask) { record.pending &= ~state.mask; skipped++ }
        }
        this.skip(state, skipped)
        state.dropped = levelCounts()
        continue
      }
      this.writeBatch(state)
    }
    this.continueDispatch()
  }

  private writeBatch(state: OutputState) {
    const batch: LogRecord[] = []
    const records: PendingRecord[] = []
    let size = 0
    if (Object.values(state.dropped).some(Boolean)) {
      const summary = createRecord('warn', 'logging.queue_dropped', state.dropped)
      state.dropped = levelCounts()
      batch.push(summary); size += summary.bytes
    }
    if (Object.values(state.failures).some(Boolean)) {
      const summary = createRecord('warn', 'logging.output_failed', state.failures)
      state.failures = outputCounts()
      batch.push(summary); size += summary.bytes
    }
    if (Object.values(state.skipped).some(Boolean)) {
      const summary = createRecord('warn', 'logging.output_dropped', state.skipped)
      state.skipped = outputCounts()
      batch.push(summary); size += summary.bytes
    }
    for (const record of this.queue) {
      if (!(record.pending & state.mask)) continue
      if (batch.length >= 64 || size + record.bytes > 64 * 1024) break
      batch.push(record); records.push(record); size += record.bytes
      record.writing |= state.mask
    }
    const content = batch.map(record => record.line).join('')
    // 两个输出端共用有界记录，各自最多一批在途写入，不因一端慢而主动丢掉其副本。
    state.busy = true
    void Promise.resolve().then(() => state.sink.write(content)).then(() => {
      state.retryAt = 0
    }, () => {
      for (const output of this.sinks) output.failures[state.sink.name]++
      state.retryAt = performance.now() + 30_000
    }).finally(() => {
      state.busy = false
      for (const record of records) {
        record.pending &= ~state.mask; record.writing &= ~state.mask
      }
      this.continueDispatch()
    })
  }

  private continueDispatch() {
    let retained = 0
    for (const record of this.queue) {
      if (record.pending) this.queue[retained++] = record
      else this.bytes -= record.bytes
    }
    this.queue.length = retained
    // 输出故障与跳过副本只随下一批业务日志汇总，避免递归与空转重试。
    this.schedule()
    if (this.isIdle()) this.idle?.()
  }
}

export function createProcessLogger(directory: () => string) {
  return new ProcessLogger([fileLogSink(directory), stderrLogSink()])
}
