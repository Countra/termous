import type {
  CoreStartupFailure,
  CoreStartupSnapshot,
  DatabaseStartupState,
} from '#common/contracts'
import type { CoreStartupEvent } from './coreStartupProtocol.ts'
import { coreReadyTimeoutMs, coreStartupSilenceMs } from './coreLifecyclePolicy.ts'

const databaseSlowMs = 60_000

export function initialCoreStartupSnapshot(): CoreStartupSnapshot {
  return {
    attemptId: '', instanceId: null, revision: 0, phase: 'idle', database: null,
    failure: null, startedAt: null, updatedAt: null, attention: null,
  }
}

export class CoreStartupState {
  private snapshot = initialCoreStartupSnapshot()
  private sequence = 0
  private expectedPID: number | undefined
  private lastEventAt = 0
  private readyDeadline = 0
  private databaseStartedAt: number | null = null
  private bindFailure: CoreStartupFailure | null = null
  private readonly onChange: (snapshot: CoreStartupSnapshot) => void
  private readonly timeoutNow: (wallTime: number) => number

  constructor(
    onChange: (snapshot: CoreStartupSnapshot) => void = () => undefined,
    timeoutNow: (wallTime: number) => number = (wallTime) => wallTime,
  ) {
    this.onChange = onChange
    // 状态保留真实日期；超时使用宿主注入的单调时钟，未注入时沿用调用方显式时间。
    this.timeoutNow = timeoutNow
  }

  getSnapshot(): CoreStartupSnapshot {
    return structuredClone(this.snapshot)
  }

  getPendingFailure() {
    return this.snapshot.failure ?? this.bindFailure
  }

  begin(attemptId: string, now: number) {
    this.sequence = 0
    this.bindFailure = null
    this.expectedPID = undefined
    this.databaseStartedAt = null
    this.lastEventAt = this.timeoutNow(now)
    this.readyDeadline = this.lastEventAt + coreReadyTimeoutMs
    this.publish({
      ...initialCoreStartupSnapshot(), attemptId, revision: this.snapshot.revision,
      phase: 'starting', startedAt: new Date(now).toISOString(),
    }, now)
  }

  beginInstance(instanceId: string, now: number) {
    this.sequence = 0
    this.bindFailure = null
    this.expectedPID = undefined
    this.lastEventAt = this.timeoutNow(now)
    this.readyDeadline = this.lastEventAt + coreReadyTimeoutMs
    this.databaseStartedAt = null
    this.publish({ ...this.snapshot, database: null, databases: [], instanceId, phase: 'starting', failure: null, attention: null }, now)
  }

  bindPID(pid: number | undefined) {
    this.expectedPID = pid
  }

  setExternal(now: number) {
    this.publish({ ...this.snapshot, phase: 'external', instanceId: null }, now)
  }

  accept(event: CoreStartupEvent, now: number) {
    if (event.instanceId !== this.snapshot.instanceId || event.pid !== this.expectedPID
      || event.sequence <= this.sequence || this.snapshot.phase === 'failed' || this.snapshot.phase === 'ready') return false
    // 旧阶段的迟到消息不能重新打开已经结束的数据库等待窗口。
    if (this.snapshot.phase === 'services' && (event.phase === 'database' || event.phase === 'starting')) return false
    if (this.snapshot.phase === 'database' && event.phase === 'starting') return false
    // 迟到的服务回执不能续期；首次确认正在处理数据库时保留安全等待，明确失败仍保留原因。
    if (!event.error && event.phase !== 'database' && this.hasReadyTimedOut(now)) return false
    this.sequence = event.sequence
    const elapsed = this.timeoutNow(now)
    this.lastEventAt = elapsed
    if (event.error?.code === 'CORE_BIND_FAILED') {
      // 端口冲突允许受控重试，最终耗尽前不向启动窗口发布终态错误。
      this.bindFailure = event.error
      return true
    }
    if (event.phase === 'database' && this.databaseStartedAt === null) this.databaseStartedAt = elapsed
    if (event.phase === 'services' && this.snapshot.phase !== 'services') this.readyDeadline = elapsed + coreReadyTimeoutMs
    const database = this.mergeDatabase(event.database)
    const next: CoreStartupSnapshot = {
      ...this.snapshot, phase: event.phase, database,
      databases: event.databases ? structuredClone(event.databases) : this.snapshot.databases,
      failure: event.error ?? null,
      attention: event.phase === 'database' && this.databaseStartedAt !== null
        && elapsed - this.databaseStartedAt >= databaseSlowMs ? 'slow' : null,
      coreVersion: event.coreVersion ?? this.snapshot.coreVersion,
    }
    // 心跳只更新接收时间，相同状态不反复广播或刷新界面展示计时。
    if (JSON.stringify({ ...next, revision: 0, updatedAt: null }) !== JSON.stringify({ ...this.snapshot, revision: 0, updatedAt: null })) {
      this.publish(next, now)
    }
    return true
  }

  tick(now: number) {
    if (this.snapshot.phase !== 'database') return
    const elapsed = this.timeoutNow(now)
    const attention = elapsed - this.lastEventAt >= coreStartupSilenceMs
      ? 'unresponsive'
      : this.databaseStartedAt !== null && elapsed - this.databaseStartedAt >= databaseSlowMs ? 'slow' : null
    if (this.snapshot.attention !== attention) this.publish({ ...this.snapshot, attention }, now)
  }

  hasReadyTimedOut(now: number) {
    return (this.snapshot.phase === 'starting' || this.snapshot.phase === 'services')
      && this.timeoutNow(now) >= this.readyDeadline
  }

  ready(now: number) {
    if (this.snapshot.phase !== 'failed') this.publish({ ...this.snapshot, phase: 'ready', attention: null }, now)
  }

  fail(failure: CoreStartupFailure, now: number) {
    if (this.snapshot.failure) return
    this.publish({ ...this.snapshot, phase: 'failed', failure, attention: null }, now)
  }

  private mergeDatabase(next: DatabaseStartupState | undefined) {
    const previous = this.snapshot.database
    if (!next) return previous
    // 重试端口或恢复时可能再次检查同一数据库，保留本轮已经完成的更新摘要。
    if (previous?.id === next.id && previous?.domain === next.domain && previous?.role === next.role
      && previous?.status === 'completed' && (next.status === 'checking' || next.status === 'unchanged')) return previous
    return { ...next }
  }

  private publish(snapshot: CoreStartupSnapshot, now: number) {
    this.snapshot = { ...snapshot, revision: this.snapshot.revision + 1, updatedAt: new Date(now).toISOString() }
    this.onChange(this.getSnapshot())
  }
}

export class CoreStartupError extends Error {
  readonly code: string
  readonly failure: CoreStartupFailure

  constructor(failure: CoreStartupFailure) {
    super(failure.message)
    this.name = 'CoreStartupError'
    this.code = failure.code
    this.failure = failure
  }
}

export function isCoreBindFailure(error: unknown) {
  return error instanceof Error && 'code' in error
    && (error.code === 'CORE_BIND_FAILED' || error.code === 'EADDRINUSE')
}
