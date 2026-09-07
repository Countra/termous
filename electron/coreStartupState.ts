import type {
  CoreStartupFailure,
  CoreStartupSnapshot,
  DatabaseStartupState,
} from '#common/contracts'
import type { CoreStartupEvent } from './coreStartupProtocol.ts'

const readyTimeoutMs = 12_000
const databaseSlowMs = 60_000
const startupSilenceMs = 15_000

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

  constructor(onChange: (snapshot: CoreStartupSnapshot) => void = () => undefined) {
    this.onChange = onChange
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
    this.lastEventAt = now
    this.readyDeadline = now + readyTimeoutMs
    this.publish({
      ...initialCoreStartupSnapshot(), attemptId, revision: this.snapshot.revision,
      phase: 'starting', startedAt: new Date(now).toISOString(),
    }, now)
  }

  beginInstance(instanceId: string, now: number) {
    this.sequence = 0
    this.bindFailure = null
    this.expectedPID = undefined
    this.lastEventAt = now
    this.readyDeadline = now + readyTimeoutMs
    this.databaseStartedAt = null
    this.publish({ ...this.snapshot, instanceId, phase: 'starting', failure: null, attention: null }, now)
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
    this.sequence = event.sequence
    this.lastEventAt = now
    if (event.error?.code === 'CORE_BIND_FAILED') {
      // 端口冲突允许受控重试，最终耗尽前不向启动窗口发布终态错误。
      this.bindFailure = event.error
      return true
    }
    if (event.phase === 'database' && this.databaseStartedAt === null) this.databaseStartedAt = now
    if (event.phase === 'services' && this.snapshot.phase !== 'services') this.readyDeadline = now + readyTimeoutMs
    const database = this.mergeDatabase(event.database)
    const next: CoreStartupSnapshot = {
      ...this.snapshot, phase: event.phase, database,
      failure: event.error ?? null,
      attention: event.phase === 'database' && this.databaseStartedAt !== null
        && now - this.databaseStartedAt >= databaseSlowMs ? 'slow' : null,
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
    const attention = now - this.lastEventAt >= startupSilenceMs
      ? 'unresponsive'
      : this.databaseStartedAt !== null && now - this.databaseStartedAt >= databaseSlowMs ? 'slow' : null
    if (this.snapshot.attention !== attention) this.publish({ ...this.snapshot, attention }, now)
  }

  hasReadyTimedOut(now: number) {
    return this.snapshot.phase !== 'database' && this.snapshot.phase !== 'ready'
      && this.snapshot.phase !== 'failed' && now >= this.readyDeadline
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
    if (previous?.status === 'completed' && (next.status === 'checking' || next.status === 'unchanged')) return previous
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
