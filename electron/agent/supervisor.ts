import { randomUUID } from 'node:crypto'
import type {
  AgentRuntimeCommandResult,
  AgentRuntimeRunRef,
  AgentRuntimeStatus,
  AgentRuntimeSteerRequest,
} from '#common/contracts'
import type {
  AgentCoreRuntimePort,
  AgentRuntimeFailureCategory,
  AgentSupervisorLease,
} from './coreRuntimeClient.ts'
import { validGeneration, validRunID } from './protocol.ts'
import {
  AgentRunWorker,
  stableAgentRuntimeErrorCode,
  type AgentRunWorkerLogger,
} from './runWorker.ts'
import type { AgentWorkerFactory } from './workerProcess.ts'

const defaultLeaseRefreshIntervalMs = 10_000
const defaultWorkerAbortGraceMs = 5_000
const defaultWorkerKillWaitMs = 2_000
const defaultSettledExitGraceMs = 5_000
const maxSteerMessageBytes = 1 << 20

export type AgentSupervisorLogger = AgentRunWorkerLogger

export interface AgentSupervisorOptions {
  core: AgentCoreRuntimePort
  workerFactory: AgentWorkerFactory
  logger?: AgentSupervisorLogger
  newInstanceID?: () => string
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  leaseRefreshIntervalMs?: number
  workerAbortGraceMs?: number
  workerKillWaitMs?: number
  settledExitGraceMs?: number
}

export class AgentSupervisor {
  private readonly core: AgentCoreRuntimePort
  private readonly workerFactory: AgentWorkerFactory
  private readonly logger?: AgentSupervisorLogger
  private readonly supervisorInstanceID: string
  private readonly setTimeoutImplementation: typeof globalThis.setTimeout
  private readonly clearTimeoutImplementation: typeof globalThis.clearTimeout
  private readonly leaseRefreshIntervalMs: number
  private readonly workerAbortGraceMs: number
  private readonly workerKillWaitMs: number
  private readonly settledExitGraceMs: number
  private readonly listeners = new Set<(status: AgentRuntimeStatus) => void>()
  private status: AgentRuntimeStatus = { state: 'offline' }
  private lease: AgentSupervisorLease | null = null
  private leasePromise: Promise<AgentSupervisorLease> | null = null
  private leaseTimer: ReturnType<typeof setTimeout> | null = null
  private leaseEnabled = false
  private worker: AgentRunWorker | null = null
  private operationTail: Promise<void> = Promise.resolve()

  constructor(options: AgentSupervisorOptions) {
    this.core = options.core
    this.workerFactory = options.workerFactory
    this.logger = options.logger
    this.supervisorInstanceID = (options.newInstanceID ?? randomUUID)()
    this.setTimeoutImplementation = options.setTimeout ?? globalThis.setTimeout
    this.clearTimeoutImplementation = options.clearTimeout ?? globalThis.clearTimeout
    this.leaseRefreshIntervalMs = options.leaseRefreshIntervalMs ?? defaultLeaseRefreshIntervalMs
    this.workerAbortGraceMs = options.workerAbortGraceMs ?? defaultWorkerAbortGraceMs
    this.workerKillWaitMs = options.workerKillWaitMs ?? defaultWorkerKillWaitMs
    this.settledExitGraceMs = options.settledExitGraceMs ?? defaultSettledExitGraceMs
  }

  getStatus() {
    return { ...this.status }
  }

  subscribe(listener: (status: AgentRuntimeStatus) => void) {
    this.listeners.add(listener)
    this.notifyListener(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async initialize() {
    this.leaseEnabled = true
    try {
      await this.runExclusive(() => this.refreshLease())
    } catch (error) {
      await this.runExclusive(() => this.handleLeaseRefreshFailure(error))
    } finally {
      this.scheduleLeaseRefresh()
    }
    return this.getStatus()
  }

  startRun(request: AgentRuntimeRunRef) {
    return this.runExclusive(() => this.startRunExclusive(request))
  }

  stopRun(request: AgentRuntimeRunRef) {
    return this.runExclusive(async () => {
      if (!validRunRef(request)) {
        return this.rejected('AGENT_RUNTIME_REQUEST_INVALID')
      }
      const active = this.worker
      if (!active) {
        return this.rejected('AGENT_RUNTIME_RUN_NOT_ACTIVE')
      }
      if (!active.matches(request)) {
        return this.rejected('AGENT_RUNTIME_RUN_CONFLICT')
      }
      await this.stopActiveWorker(active, false)
      return this.accepted()
    })
  }

  steerRun(request: AgentRuntimeSteerRequest) {
    return this.runExclusive(async () => {
      if (!validRunRef(request)
        || typeof request.message !== 'string'
        || request.message.trim() === ''
        || Buffer.byteLength(request.message, 'utf8') > maxSteerMessageBytes) {
        return this.rejected('AGENT_RUNTIME_STEER_INVALID')
      }
      const active = this.worker
      if (!active || !active.matches(request) || active.isStopping()) {
        return this.rejected('AGENT_RUNTIME_RUN_NOT_ACTIVE')
      }
      if (!active.steer(request.message)) {
        return this.rejected('AGENT_RUNTIME_WORKER_UNAVAILABLE')
      }
      return this.accepted()
    })
  }

  shutdown() {
    return this.runExclusive(async () => {
      this.leaseEnabled = false
      this.clearLeaseTimer()
      const lease = this.lease
      this.lease = null
      const active = this.worker
      if (active) {
        await this.stopActiveWorker(active, true)
      }
      if (lease) {
        try {
          await this.core.unregisterSupervisor(this.supervisorInstanceID, lease.revision)
        } catch {
          // Core 可能已开始退出，租约会在 30 秒内自行失效。
        }
      }
      if (active && this.worker === active) {
        throw new Error('AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
      }
      this.publish({ state: 'offline' })
    })
  }

  private async startRunExclusive(request: AgentRuntimeRunRef): Promise<AgentRuntimeCommandResult> {
    if (!validRunRef(request)) {
      return this.rejected('AGENT_RUNTIME_REQUEST_INVALID')
    }
    if (!this.leaseEnabled) {
      return this.rejected('AGENT_RUNTIME_UNAVAILABLE')
    }
    const active = this.worker
    if (active) {
      return active.matches(request)
        ? this.accepted()
        : this.rejected('AGENT_RUNTIME_RUN_CONFLICT')
    }
    let lease: AgentSupervisorLease
    try {
      lease = await this.refreshLease()
    } catch (error) {
      const code = stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_UNAVAILABLE')
      this.publish({ state: 'offline', error_code: code })
      return this.rejected(code)
    }
    let createdWorker: AgentRunWorker | null = null
    try {
      const coreBaseURL = await this.core.currentBaseURL()
      const process = this.workerFactory.create()
      const worker = new AgentRunWorker({
        process,
        request,
        coreInstanceID: lease.core_instance_id,
        coreBaseURL,
        supervisorInstanceID: this.supervisorInstanceID,
        core: this.core,
        logger: this.logger,
        enqueue: (operation) => this.runExclusive(operation),
        reportFailure: (category) => this.reportFailure(request, category),
        publish: (status) => {
          if (this.worker === worker) {
            this.publish(status)
          }
        },
        onExited: (target) => this.handleWorkerExited(target),
        setTimeout: this.setTimeoutImplementation,
        clearTimeout: this.clearTimeoutImplementation,
        abortGraceMs: this.workerAbortGraceMs,
        killWaitMs: this.workerKillWaitMs,
        settledExitGraceMs: this.settledExitGraceMs,
      })
      createdWorker = worker
      this.worker = worker
      this.publish({
        state: 'starting',
        active_run_id: request.run_id,
        generation: request.generation,
      })
      worker.observe()
      return this.accepted()
    } catch (error) {
      const code = stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_LAUNCH_FAILED')
      if (createdWorker && this.worker === createdWorker) {
        await createdWorker.failLaunch(code)
        return this.rejected(code)
      }
      await this.reportFailure(request, 'launch_failed')
      this.publish({ state: 'ready', error_code: code })
      return this.rejected(code)
    }
  }

  private handleWorkerExited(worker: AgentRunWorker) {
    if (this.worker !== worker) {
      return
    }
    this.worker = null
    this.publish(this.lease ? { state: 'ready' } : { state: 'offline' })
  }

  private async stopActiveWorker(worker: AgentRunWorker, shutdown: boolean) {
    if (this.worker === worker) {
      await worker.stop(shutdown)
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

  private refreshLease() {
    if (!this.leaseEnabled) {
      return Promise.reject(new Error('AGENT_RUNTIME_UNAVAILABLE'))
    }
    if (this.leasePromise) {
      return this.leasePromise
    }
    const pending = this.core.registerSupervisor(this.supervisorInstanceID)
      .then(async (lease) => {
        const previous = this.lease
        this.lease = lease
        if (previous && previous.core_instance_id !== lease.core_instance_id && this.worker) {
          const active = this.worker
          await this.stopActiveWorker(active, false)
          if (this.worker === active) {
            throw new Error('AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
          }
        }
        if (!this.worker) {
          this.publish({ state: 'ready' })
        }
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
    const lease = this.lease
    if (!lease || Date.parse(lease.expires_at) <= Date.now()) {
      this.lease = null
      const active = this.worker
      if (active) {
        await this.stopActiveWorker(active, false)
      }
      if (active && this.worker === active) {
        this.publish({
          state: 'stopping',
          active_run_id: active.runID,
          generation: active.generation,
          error_code: 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT',
        })
        return
      }
      this.publish({ state: 'offline', error_code: code })
      return
    }
    const active = this.worker
    if (!active) {
      this.publish({ state: 'ready', error_code: code })
    } else if (active.isStopping()) {
      this.publish({
        state: 'stopping',
        active_run_id: active.runID,
        generation: active.generation,
        error_code: code,
      })
    }
  }

  private publish(status: AgentRuntimeStatus) {
    if (sameStatus(this.status, status)) {
      return
    }
    this.status = { ...status }
    for (const listener of this.listeners) {
      this.notifyListener(listener)
    }
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

function validRunRef(value: AgentRuntimeRunRef) {
  return validRunID(value?.run_id) && validGeneration(value?.generation)
}

function sameStatus(left: AgentRuntimeStatus, right: AgentRuntimeStatus) {
  return left.state === right.state
    && left.active_run_id === right.active_run_id
    && left.generation === right.generation
    && left.error_code === right.error_code
}
