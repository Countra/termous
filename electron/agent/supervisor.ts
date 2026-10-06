import { randomUUID } from 'node:crypto'
import type {
  AgentQueuedTurnSteerRequest,
  AgentRuntimeCommandResult,
  AgentRuntimeRunRef,
  AgentRuntimeStatus,
  AgentRuntimeWorkerStatus,
  AgentRuntimeSteerRequest,
  AgentSkillsBundleStatus,
} from '#common/contracts'
import type {
  AgentCoreRuntimePort,
  AgentRuntimeFailureCategory,
  AgentSupervisorLease,
  AgentRuntimeAllocation,
} from './coreRuntimeClient.ts'
import { validGeneration, validRunID } from './protocol.ts'
import {
  AgentRunWorker,
  stableAgentRuntimeErrorCode,
  type AgentRunWorkerLogger,
  type AgentRunWorkerSteerResult,
} from './runWorker.ts'
import type { AgentWorkerFactory } from './workerProcess.ts'
import type { AgentSkillBundleSnapshot } from './skillBundle.ts'
import type { AgentSkillBundleSourcePort } from './skillBundleSource.ts'
import { AgentControlChannel } from './controlChannel.ts'

const defaultLeaseRefreshIntervalMs = 10_000
const defaultWorkerAbortGraceMs = 5_000
const defaultWorkerKillWaitMs = 2_000
const defaultSettledExitGraceMs = 5_000
// 确认预算覆盖事件队列等待与一次 Core 写入超时，避免先报失败后又落库。
const defaultSteerAckTimeoutMs = 60_000
const maxSteerMessageBytes = 1 << 20

export type AgentSupervisorLogger = AgentRunWorkerLogger

type PreparedAgentSteer =
  | { command: AgentRuntimeCommandResult }
  | { pending: Promise<AgentRunWorkerSteerResult> }

export interface AgentSupervisorOptions {
  core: AgentCoreRuntimePort
  workerFactory: AgentWorkerFactory
  skills: AgentSkillBundleSourcePort
  logger?: AgentSupervisorLogger
  newInstanceID?: () => string
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  leaseRefreshIntervalMs?: number
  workerAbortGraceMs?: number
  workerKillWaitMs?: number
  settledExitGraceMs?: number
  steerAckTimeoutMs?: number
}

export class AgentSupervisor {
  private readonly core: AgentCoreRuntimePort
  private readonly workerFactory: AgentWorkerFactory
  private readonly skills: AgentSkillBundleSourcePort
  private readonly logger?: AgentSupervisorLogger
  private readonly supervisorInstanceID: string
  private readonly setTimeoutImplementation: typeof globalThis.setTimeout
  private readonly clearTimeoutImplementation: typeof globalThis.clearTimeout
  private readonly leaseRefreshIntervalMs: number
  private readonly workerAbortGraceMs: number
  private readonly workerKillWaitMs: number
  private readonly settledExitGraceMs: number
  private readonly steerAckTimeoutMs: number
  private readonly listeners = new Set<(status: AgentRuntimeStatus) => void>()
  private status: AgentRuntimeStatus = { state: 'offline' }
  private lease: AgentSupervisorLease | null = null
  private lastLeaseGeneration: AgentSupervisorLease | null = null
  private leasePromise: Promise<AgentSupervisorLease> | null = null
  private leaseTimer: ReturnType<typeof setTimeout> | null = null
  private leaseEnabled = false
  private lifecycleRevision = 0
  private skillsStatus: AgentSkillsBundleStatus = unavailableSkillsStatus()
  private readonly workers = new Map<string, AgentRunWorker>()
  private readonly workerStates = new Map<string, AgentRuntimeWorkerStatus>()
  private readonly allocations = new Map<string, { allocation: AgentRuntimeAllocation; lease: AgentSupervisorLease }>()
  private readonly pendingReleases = new Map<string, { allocation: AgentRuntimeAllocation; lease: AgentSupervisorLease }>()
  private claimSequence = 1
  private wakePromise: Promise<AgentRuntimeCommandResult> | null = null
  private wakeRequested = false
  private operationTail: Promise<void> = Promise.resolve()
  private readonly controlChannel: AgentControlChannel

  constructor(options: AgentSupervisorOptions) {
    this.core = options.core
    this.controlChannel = new AgentControlChannel(this.core, async (command) => {
      if (!this.leaseEnabled) return this.rejected('AGENT_RUNTIME_UNAVAILABLE')
      if (command.action === 'wake') return this.wakeQueue()
      const request = { run_id: command.run_id!, generation: command.generation! }
      if (command.action === 'start') return this.startRun(request)
      if (command.action === 'stop') return this.stopRun(request)
      return this.steerRun({ ...request, message: command.message! }, command.id)
    })
    this.workerFactory = options.workerFactory
    this.skills = options.skills
    this.logger = options.logger
    this.supervisorInstanceID = (options.newInstanceID ?? randomUUID)()
    this.setTimeoutImplementation = options.setTimeout ?? globalThis.setTimeout
    this.clearTimeoutImplementation = options.clearTimeout ?? globalThis.clearTimeout
    this.leaseRefreshIntervalMs = options.leaseRefreshIntervalMs ?? defaultLeaseRefreshIntervalMs
    this.workerAbortGraceMs = options.workerAbortGraceMs ?? defaultWorkerAbortGraceMs
    this.workerKillWaitMs = options.workerKillWaitMs ?? defaultWorkerKillWaitMs
    this.settledExitGraceMs = options.settledExitGraceMs ?? defaultSettledExitGraceMs
    this.steerAckTimeoutMs = options.steerAckTimeoutMs ?? defaultSteerAckTimeoutMs
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status, workers: this.status.workers?.map((worker) => ({ ...worker })) }
  }

  // 仅主进程内部使用；单次补全借用活租约，不创建聊天 Run 或推进其队列。
  completionLease() {
    if (!this.leaseEnabled || !this.lease || Date.parse(this.lease.expires_at) <= Date.now()) {
      throw new Error('AGENT_RUNTIME_UNAVAILABLE')
    }
    return { ...this.lease }
  }

  subscribe(listener: (status: AgentRuntimeStatus) => void) {
    this.listeners.add(listener)
    this.notifyListener(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async initialize() {
    const lifecycleRevision = ++this.lifecycleRevision
    return this.runExclusive(async () => {
      if (lifecycleRevision !== this.lifecycleRevision) {
        return this.getStatus()
      }
      this.leaseEnabled = true
      try {
        await this.refreshLease()
        if (lifecycleRevision === this.lifecycleRevision && this.leaseEnabled) {
          await this.pumpQueueExclusive(false)
        }
      } catch (error) {
        if (lifecycleRevision === this.lifecycleRevision) {
          await this.handleLeaseRefreshFailure(error)
        }
      } finally {
        if (lifecycleRevision === this.lifecycleRevision) {
          this.scheduleLeaseRefresh()
        }
      }
      return this.getStatus()
    })
  }

  startRun(request: AgentRuntimeRunRef) {
    if (!validRunRef(request)) return Promise.resolve(this.rejected('AGENT_RUNTIME_REQUEST_INVALID'))
    // 创建 Run 已由 Core 受理；所有入口只唤醒统一领取流程。
    return this.wakeQueue()
  }

  wakeQueue() {
    this.wakeRequested = true
    if (this.wakePromise) return this.wakePromise
    const pending = this.runExclusive(async () => {
      let result: AgentRuntimeCommandResult
      do {
        this.wakeRequested = false
        result = await this.pumpQueueExclusive()
      } while (this.wakeRequested && this.leaseEnabled && result.accepted)
      return result
    }).finally(() => {
      if (this.wakePromise === pending) this.wakePromise = null
    })
    this.wakePromise = pending
    return pending
  }

  stopRun(request: AgentRuntimeRunRef) {
    if (!validRunRef(request)) {
      return Promise.resolve(this.rejected('AGENT_RUNTIME_REQUEST_INVALID'))
    }
    const active = this.workers.get(runKey(request))
    if (!active) {
      return Promise.resolve(this.rejected('AGENT_RUNTIME_RUN_NOT_ACTIVE'))
    }
    if (!active.matches(request)) {
      return Promise.resolve(this.rejected('AGENT_RUNTIME_RUN_CONFLICT'))
    }
    // 取消信号不等待续租或队列维护等串行操作，避免模型流继续占用运行资源。
    active.requestStop()
    return active.stop(false).then(() => this.accepted())
  }

  steerRun(request: AgentRuntimeSteerRequest, clientRequestID?: string): Promise<AgentRuntimeCommandResult> {
    return Promise.resolve().then<PreparedAgentSteer>(() => {
      if (!validRunRef(request)
        || typeof request.message !== 'string'
        || request.message.trim() === ''
        || Buffer.byteLength(request.message, 'utf8') > maxSteerMessageBytes) {
        return { command: this.rejected('AGENT_RUNTIME_STEER_INVALID') }
      }
      const active = this.workers.get(runKey(request))
      if (!active || !active.matches(request) || active.isStopping()) {
        return { command: this.rejected('AGENT_RUNTIME_RUN_NOT_ACTIVE') }
      }
      // 等待 Worker 确认时不占用 Supervisor 串行队列，使 stop/shutdown 能立即取消在途请求。
      return { pending: active.steer(request.message, clientRequestID) }
    }).then(async (prepared) => {
      if ('command' in prepared) return prepared.command
      const result = await prepared.pending
      return result.accepted
        ? this.accepted()
        : this.rejected(result.error_code ?? 'AGENT_RUNTIME_STEER_REJECTED')
    })
  }

  async steerQueuedTurn(request: AgentQueuedTurnSteerRequest) {
    if (!validQueuedTurnSteerRequest(request)) {
      return this.rejected('AGENT_RUNTIME_STEER_INVALID')
    }
    const active = this.workers.get(runKey(request))
    if (!active || !active.matches(request) || active.isStopping()) {
      return this.rejected('AGENT_RUNTIME_RUN_NOT_ACTIVE')
    }
    // Core 原子写入不依赖 Supervisor 生命周期队列，避免续租或 claim 网络等待拖延中断操作。
    try {
      await this.core.steerQueuedTurn(request)
    } catch (error) {
      return this.rejected(stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_STEER_REJECTED'))
    }
    // 后继轮次持久化成功后立即启动取消预算，生命周期清理仍保持串行。
    active.requestStop()
    return active.stop(false).then(() => this.accepted())
  }

  shutdown() {
    this.lifecycleRevision += 1
    this.leaseEnabled = false
    this.controlChannel.close()
    this.clearLeaseTimer()
    for (const worker of this.workers.values()) worker.requestStop()
    return this.runExclusive(async () => {
      const lease = this.lease
      await this.stopAllWorkers(true)
      if (lease) {
        try { await this.core.unregisterSupervisor(this.supervisorInstanceID, lease.revision) }
        catch { /* Core 退出时允许租约自然失效。 */ }
      }
      this.lease = null
      this.publish({ state: 'offline' })
    })
  }

  private async startAllocation(request: AgentRuntimeAllocation, lease: AgentSupervisorLease): Promise<string | undefined> {
    const key = runKey(request)
    if (this.workers.has(key)) return
    this.allocations.set(key, { allocation: request, lease })
    let createdWorker: AgentRunWorker | null = null
    try {
      let skills: AgentSkillBundleSnapshot
      try { skills = await this.skills.snapshot() }
      catch (error) {
        await this.refreshLease({ ...unavailableSkillsStatus(), error_category: 'snapshot_failed' })
        throw error
      }
      if (skills.fingerprint !== this.skillsStatus.fingerprint) {
        const refreshed = await this.refreshLease(skillsStatusFromSnapshot(skills))
        if (!sameLeaseGeneration(lease, refreshed)) throw new Error('AGENT_RUNTIME_SUPERVISOR_LOST')
      }
      const coreBaseURL = await this.core.currentBaseURL()
      if (!this.leaseEnabled) throw new Error('AGENT_RUNTIME_UNAVAILABLE')
      let workerTail: Promise<void> = Promise.resolve()
      const worker = new AgentRunWorker({
        process: this.workerFactory.create(), request,
        executionID: request.execution_id, sessionID: request.session_id,
        coreInstanceID: lease.core_instance_id, coreBaseURL, skills,
        supervisorInstanceID: this.supervisorInstanceID, core: this.core, logger: this.logger,
        enqueue: <T>(operation: () => Promise<T>) => {
          const pending = workerTail.then(operation, operation)
          workerTail = pending.then(() => undefined, () => undefined)
          return pending
        },
        reportFailure: (category) => this.reportFailure(request, category),
        publish: (status) => {
          if (this.workers.get(key) === worker) {
            this.workerStates.set(key, status)
            this.publish(this.idleStatus())
          }
        },
        onExited: (target) => this.handleWorkerExited(target),
        setTimeout: this.setTimeoutImplementation, clearTimeout: this.clearTimeoutImplementation,
        abortGraceMs: this.workerAbortGraceMs, killWaitMs: this.workerKillWaitMs,
        settledExitGraceMs: this.settledExitGraceMs, steerAckTimeoutMs: this.steerAckTimeoutMs,
      })
      createdWorker = worker
      this.workers.set(key, worker)
      this.workerStates.set(key, { state: 'starting', run_id: request.run_id, generation: request.generation, session_id: request.session_id })
      this.publish(this.idleStatus())
      worker.observe()
    } catch (error) {
      const code = stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_LAUNCH_FAILED')
      if (createdWorker) await createdWorker.failLaunch(code)
      else {
        await this.reportFailure(request, 'launch_failed')
        await this.releaseAllocation(key)
      }
      this.publish({ ...this.idleStatus(), error_code: code })
      return code
    }
  }

  private async handleWorkerExited(worker: AgentRunWorker) {
    const key = runKey({ run_id: worker.runID, generation: worker.generation })
    if (this.workers.get(key) !== worker) return
    this.workers.delete(key)
    this.workerStates.delete(key)
    await this.releaseAllocation(key)
    this.publish(this.idleStatus())
    // 退出回调属于 Worker 队列，不等待 Supervisor，以免换代清理互相等待。
    if (this.leaseEnabled) void this.wakeQueue()
  }

  private async releaseAllocation(key: string) {
    const entry = this.allocations.get(key)
    if (!entry) return
    this.allocations.delete(key)
    this.pendingReleases.set(key, entry)
    await this.flushRelease(key, entry)
  }

  private async flushRelease(key: string, entry: { allocation: AgentRuntimeAllocation; lease: AgentSupervisorLease }) {
    if (this.lease && !sameLeaseGeneration(this.lease, entry.lease)) {
      this.pendingReleases.delete(key)
      return
    }
    try {
      await this.core.releaseExecution(this.supervisorInstanceID, entry.lease.supervisor_epoch, entry.allocation)
      this.pendingReleases.delete(key)
    } catch (error) {
      this.logger?.error('agent-runtime-execution-release-failed', { run_id: entry.allocation.run_id,
        error_code: stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_UNAVAILABLE') })
    }
  }

  private async pumpQueueExclusive(refreshLeaseBeforeClaim = true): Promise<AgentRuntimeCommandResult> {
    if (!this.leaseEnabled) return this.rejected('AGENT_RUNTIME_UNAVAILABLE')
    try {
      if (refreshLeaseBeforeClaim || !this.lease) {
        try { await this.refreshLease() }
        catch (error) { await this.handleLeaseRefreshFailure(error); throw error }
      }
      if (!this.lease || this.skillsStatus.status !== 'ready') return this.rejected('AGENT_SKILLS_BUNDLE_NOT_READY')
      for (const [key, entry] of this.pendingReleases) await this.flushRelease(key, entry)
      let launchError: string | undefined
      while (this.leaseEnabled && this.skillsStatus.status === 'ready' && this.workers.size < this.lease.max_concurrent_runs) {
        const lease = this.lease
        // 只有收到有效响应才递增序号；响应丢失时下一次仍领取原分配。
        const claimed = await this.core.claimNextQueuedRun(this.supervisorInstanceID, lease.supervisor_epoch, this.claimSequence)
        this.claimSequence += 1
        lease.max_concurrent_runs = claimed.max_concurrent_runs
        if (!claimed.allocation) break
        launchError = await this.startAllocation(claimed.allocation, lease) ?? launchError
      }
      this.publish({ ...this.idleStatus(), ...(launchError ? { error_code: launchError } : {}) })
      return this.accepted()
    } catch (error) {
      const code = stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_QUEUE_UNAVAILABLE')
      this.logger?.error('agent-runtime-queue-claim-failed', { error_code: code })
      this.publish({ ...this.idleStatus(), error_code: code })
      return this.rejected(code)
    }
  }

  private async stopAllWorkers(shutdown: boolean) {
    const workers = [...this.workers.values()]
    for (const worker of workers) worker.requestStop()
    await Promise.all(workers.map((worker) => worker.stop(shutdown)))
    if (workers.some((worker) => this.workers.get(runKey({ run_id: worker.runID, generation: worker.generation })) === worker)) {
      throw new Error('AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
    }
  }

  private async reportFailure(request: AgentRuntimeRunRef, category: AgentRuntimeFailureCategory) {
    try {
      await this.core.reportRuntimeFailure(
        this.supervisorInstanceID,
        request.run_id,
        request.generation,
        category,
      )
    } catch (error) {
      this.logger?.error('agent-runtime-failure-report-failed', {
        run_id: request.run_id,
        generation: request.generation,
        category,
        error_code: stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_UNAVAILABLE'),
      })
    }
  }

  private refreshLease(statusOverride?: AgentSkillsBundleStatus) {
    if (!this.leaseEnabled) {
      return Promise.reject(new Error('AGENT_RUNTIME_UNAVAILABLE'))
    }
    if (this.leasePromise) {
      return this.leasePromise
    }
    const pending = (async () => {
      const skillsStatus = statusOverride ?? await this.skills.inspect()
      this.skillsStatus = skillsStatus
      return this.core.registerSupervisor(this.supervisorInstanceID, skillsStatus)
    })()
      .then(async (lease) => {
        const previous = this.lastLeaseGeneration
        if (!previous || !sameLeaseGeneration(previous, lease)) {
          // 在旧进程实际退出以前，不允许新租约获得执行资格。
          await this.stopAllWorkers(false)
          this.claimSequence = 1
        }
        this.lease = lease
        this.lastLeaseGeneration = lease
        if (this.leaseEnabled) this.controlChannel.attach(lease)
        this.publish(this.idleStatus())
        return lease
      })
      .finally(() => {
        if (this.leasePromise === pending) {
          this.leasePromise = null
        }
      })
    this.leasePromise = pending
    return pending
  }

  private scheduleLeaseRefresh() {
    this.clearLeaseTimer()
    if (!this.leaseEnabled) {
      return
    }
    this.leaseTimer = this.setTimeoutImplementation(() => {
      this.leaseTimer = null
      void this.runExclusive(async () => {
        try {
          await this.refreshLease()
          await this.pumpQueueExclusive(false)
        } catch (error) {
          await this.handleLeaseRefreshFailure(error)
        }
      }).finally(() => this.scheduleLeaseRefresh())
    }, this.leaseRefreshIntervalMs)
    if (typeof this.leaseTimer === 'object' && 'unref' in this.leaseTimer) {
      this.leaseTimer.unref()
    }
  }

  private clearLeaseTimer() {
    if (this.leaseTimer !== null) {
      this.clearTimeoutImplementation(this.leaseTimer)
      this.leaseTimer = null
    }
  }

  private async handleLeaseRefreshFailure(error: unknown) {
    const code = stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_UNAVAILABLE')
    this.controlChannel.close()
    try { await this.stopAllWorkers(false) }
    catch { this.publish({ state: 'offline', error_code: 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT' }); return }
    this.lease = null
    this.publish({ state: 'offline', error_code: code })
  }

  private publish(status: AgentRuntimeStatus) {
    const workers = [...this.workerStates.values()]
    const next = { ...status, capacity: this.lease?.max_concurrent_runs ?? 0,
      occupied_slots: this.allocations.size + this.pendingReleases.size, workers }
    if (sameStatus(this.status, next)) return
    this.status = next
    for (const listener of this.listeners) this.notifyListener(listener)
  }

  private idleStatus(): AgentRuntimeStatus {
    if (!this.leaseEnabled || !this.lease || this.skillsStatus.status !== 'ready') {
      return {
        state: 'offline',
        ...(this.skillsStatus.status !== 'ready'
          ? { error_code: 'AGENT_SKILLS_BUNDLE_NOT_READY' }
          : {}),
      }
    }
    return { state: 'ready' }
  }

  private notifyListener(listener: (status: AgentRuntimeStatus) => void) {
    try {
      listener(this.getStatus())
    } catch (error) {
      this.logger?.error('agent-runtime-status-listener-failed', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }

  private accepted(): AgentRuntimeCommandResult {
    return { accepted: true, status: this.getStatus() }
  }

  private rejected(errorCode: string): AgentRuntimeCommandResult {
    return { accepted: false, status: this.getStatus(), error_code: errorCode }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationTail.then(operation, operation)
    this.operationTail = pending.then(() => undefined, () => undefined)
    return pending
  }
}

function skillsStatusFromSnapshot(snapshot: AgentSkillBundleSnapshot): AgentSkillsBundleStatus {
  return {
    status: 'ready',
    fingerprint: snapshot.fingerprint,
    skill_count: snapshot.catalog.length,
    resource_count: snapshot.resources.length,
  }
}

function unavailableSkillsStatus(): AgentSkillsBundleStatus {
  return {
    status: 'unavailable',
    fingerprint: '',
    skill_count: 0,
    resource_count: 0,
    error_category: 'runtime_not_initialized',
  }
}

function validRunRef(value: AgentRuntimeRunRef) {
  return validRunID(value?.run_id) && validGeneration(value?.generation)
}

function validQueuedTurnSteerRequest(value: AgentQueuedTurnSteerRequest) {
  return validRunRef(value)
    && validRunID(value?.queued_turn_id)
    && validGeneration(value?.expected_revision)
    && validGeneration(value?.expected_run_revision)
}

function sameStatus(left: AgentRuntimeStatus, right: AgentRuntimeStatus) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function runKey(ref: AgentRuntimeRunRef) { return `${ref.run_id}:${ref.generation}` }
function sameLeaseGeneration(left: AgentSupervisorLease, right: AgentSupervisorLease) {
  return left.core_instance_id === right.core_instance_id && left.supervisor_epoch === right.supervisor_epoch
}
