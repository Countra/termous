import type {
  AgentRuntimeRunRef,
  AgentRuntimeStatus,
} from '#common/contracts'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type {
  AgentCoreRuntimePort,
  AgentRuntimeFailureCategory,
} from './coreRuntimeClient.ts'
import { isAgentWorkerOutboundMessage } from './protocol.ts'
import type { AgentWorkerProcess } from './workerProcess.ts'
import type { AgentSkillBundleSnapshot } from './skillBundle.ts'

export interface AgentRunWorkerLogger {
  info(event: string, details?: Record<string, unknown>): void
  error(event: string, details?: Record<string, unknown>): void
}

export interface AgentRunWorkerOptions {
  process: AgentWorkerProcess
  request: AgentRuntimeRunRef
  coreInstanceID: string
  coreBaseURL: string
  skills: AgentSkillBundleSnapshot
  supervisorInstanceID: string
  core: Pick<AgentCoreRuntimePort, 'issueRuntimeTicket'>
  logger?: AgentRunWorkerLogger
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>
  reportFailure: (category: AgentRuntimeFailureCategory) => Promise<void>
  publish: (status: AgentRuntimeStatus) => void
  onExited: (worker: AgentRunWorker) => Promise<void> | void
  setTimeout: typeof globalThis.setTimeout
  clearTimeout: typeof globalThis.clearTimeout
  abortGraceMs: number
  killWaitMs: number
  settledExitGraceMs: number
}

export class AgentRunWorker {
  readonly runID: string
  readonly generation: number
  private readonly process: AgentWorkerProcess
  private readonly coreInstanceID: string
  private readonly coreBaseURL: string
  private readonly supervisorInstanceID: string
  private readonly skills: AgentSkillBundleSnapshot
  private readonly core: Pick<AgentCoreRuntimePort, 'issueRuntimeTicket'>
  private readonly logger?: AgentRunWorkerLogger
  private readonly enqueue: AgentRunWorkerOptions['enqueue']
  private readonly reportFailure: AgentRunWorkerOptions['reportFailure']
  private readonly publish: AgentRunWorkerOptions['publish']
  private readonly onExited: AgentRunWorkerOptions['onExited']
  private readonly setTimeoutImplementation: typeof globalThis.setTimeout
  private readonly clearTimeoutImplementation: typeof globalThis.clearTimeout
  private readonly abortGraceMs: number
  private readonly killWaitMs: number
  private readonly settledExitGraceMs: number
  private readonly exitPromise: Promise<number>
  private resolveExit: (code: number) => void = () => undefined
  private readonly disposers: Array<() => void> = []
  private bootstrapRequested = false
  private runtimeStarted = false
  private settled = false
  private stopping = false
  private failureReported = false
  private exited = false
  private exitHandled = false
  private exitCode = 0
  private exitGuardTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: AgentRunWorkerOptions) {
    this.process = options.process
    this.runID = options.request.run_id
    this.generation = options.request.generation
    this.coreInstanceID = options.coreInstanceID
    this.coreBaseURL = options.coreBaseURL
    this.supervisorInstanceID = options.supervisorInstanceID
    this.skills = options.skills
    this.core = options.core
    this.logger = options.logger
    this.enqueue = options.enqueue
    this.reportFailure = options.reportFailure
    this.publish = options.publish
    this.onExited = options.onExited
    this.setTimeoutImplementation = options.setTimeout
    this.clearTimeoutImplementation = options.clearTimeout
    this.abortGraceMs = options.abortGraceMs
    this.killWaitMs = options.killWaitMs
    this.settledExitGraceMs = options.settledExitGraceMs
    this.exitPromise = new Promise<number>((resolve) => {
      this.resolveExit = resolve
    })
  }

  matches(request: AgentRuntimeRunRef) {
    return this.runID === request.run_id && this.generation === request.generation
  }

  isStopping() {
    return this.stopping
  }

  observe() {
    this.disposers.push(this.process.onMessage((message) => {
      if (isCurrentSettledMessage(message, this.runID, this.generation)) {
        this.acceptSettled()
        return
      }
      void this.enqueue(() => this.handleMessage(message))
    }))
    this.disposers.push(this.process.onExit((code) => {
      if (!this.exited) {
        this.exited = true
        this.exitCode = code
        this.resolveExit(code)
      }
      void this.enqueue(() => this.finalizeExit())
    }))
    this.disposers.push(this.process.onSpawn(() => {
      void this.enqueue(() => this.bootstrap())
    }))
  }

  steer(message: string) {
    if (!this.runtimeStarted || this.settled || this.stopping) {
      return false
    }
    try {
      this.process.postMessage({
        type: 'steer',
        run_id: this.runID,
        generation: this.generation,
        message,
      })
      return true
    } catch {
      return false
    }
  }

  async stop(shutdown: boolean) {
    this.stopping = true
    this.clearExitGuard()
    this.publishStatus('stopping')
    try {
      this.process.postMessage({
        type: 'abort',
        run_id: this.runID,
        generation: this.generation,
      })
    } catch {
      // 进程可能恰好退出，统一由退出信号或后续强制回收路径收口。
    }
    if (await this.waitForExit(this.abortGraceMs)) {
      await this.finalizeExit()
      return
    }
    this.kill()
    if (!this.settled && !this.failureReported) {
      this.failureReported = true
      await this.reportFailure('forced_stop')
    }
    if (await this.waitForExit(this.killWaitMs)) {
      await this.finalizeExit()
      return
    }
    this.logger?.error('agent-worker-termination-timeout', {
      run_id: this.runID,
      generation: this.generation,
      shutdown,
    })
    this.publishStatus('stopping', 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
  }

  async failLaunch(errorCode: string) {
    this.stopping = true
    if (!this.failureReported) {
      this.failureReported = true
      await this.reportFailure('launch_failed')
    }
    if (this.exited) {
      await this.finalizeExit()
      return
    }
    this.publishStatus('stopping', errorCode)
    this.kill()
    if (await this.waitForExit(this.killWaitMs)) {
      await this.finalizeExit()
      return
    }
    this.publishStatus('stopping', 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
  }

  private async bootstrap() {
    if (this.stopping || this.bootstrapRequested) {
      return
    }
    this.bootstrapRequested = true
    try {
      const ticket = await this.core.issueRuntimeTicket(
        this.supervisorInstanceID,
        this.runID,
        this.generation,
      )
      if (this.stopping) {
        return
      }
      if (ticket.core_instance_id !== this.coreInstanceID) {
        throw new Error('AGENT_RUNTIME_CORE_INSTANCE_CHANGED')
      }
      this.process.postMessage({
        type: 'start',
        protocol_version: agentRuntimeProtocolVersion,
        core_base_url: this.coreBaseURL,
        ticket: ticket.ticket,
        run_id: this.runID,
        generation: this.generation,
        skills: this.skills,
      })
    } catch (error) {
      await this.failLaunch(stableAgentRuntimeErrorCode(error, 'AGENT_RUNTIME_LAUNCH_FAILED'))
    }
  }

  private async handleMessage(message: unknown) {
    if (!isAgentWorkerOutboundMessage(message)
      || message.run_id !== this.runID
      || message.generation !== this.generation) {
      return
    }
    if (message.type === 'started') {
      if (!this.settled && !this.stopping) {
        this.runtimeStarted = true
        this.publishStatus('running')
      }
      return
    }
    if (message.type === 'settled') {
      this.acceptSettled()
      return
    }
    if (this.settled || this.failureReported) {
      return
    }
    this.failureReported = true
    this.stopping = true
    this.publishStatus(
      'stopping',
      message.category === 'bootstrap_failed'
        ? 'AGENT_RUNTIME_LAUNCH_FAILED'
        : 'AGENT_RUNTIME_WORKER_FAILED',
    )
    await this.reportFailure(
      message.category === 'bootstrap_failed' ? 'launch_failed' : 'worker_crash',
    )
    this.scheduleExitGuard()
  }

  private async finalizeExit() {
    if (!this.exited || this.exitHandled) {
      return
    }
    this.exitHandled = true
    this.clearExitGuard()
    this.dispose()
    if (!this.settled && !this.failureReported) {
      this.failureReported = true
      await this.reportFailure(
        this.stopping
          ? 'forced_stop'
          : this.runtimeStarted
            ? 'worker_crash'
            : 'launch_failed',
      )
    }
    this.logger?.info('agent-worker-exited', {
      run_id: this.runID,
      generation: this.generation,
      exit_code: this.exitCode,
      expected: this.settled || this.stopping,
    })
    await this.onExited(this)
  }

  private scheduleExitGuard() {
    this.clearExitGuard()
    this.exitGuardTimer = this.setTimeoutImplementation(() => {
      this.exitGuardTimer = null
      void this.enqueue(() => this.forceExitAfterGuard())
    }, this.settledExitGraceMs)
    if (typeof this.exitGuardTimer === 'object' && 'unref' in this.exitGuardTimer) {
      this.exitGuardTimer.unref()
    }
  }

  private acceptSettled() {
    if (this.settled) {
      return
    }
    // settled 表示 Worker 已把终态事件写入 Core；同步记录可避免 stop 等待阻塞消息队列时误报强制终止。
    this.settled = true
    this.stopping = true
    this.publishStatus('stopping')
    this.scheduleExitGuard()
  }

  private clearExitGuard() {
    if (this.exitGuardTimer !== null) {
      this.clearTimeoutImplementation(this.exitGuardTimer)
      this.exitGuardTimer = null
    }
  }

  private async forceExitAfterGuard() {
    if (this.exited) {
      await this.finalizeExit()
      return
    }
    this.stopping = true
    this.publishStatus('stopping')
    this.kill()
    if (await this.waitForExit(this.killWaitMs)) {
      await this.finalizeExit()
      return
    }
    this.logger?.error('agent-worker-termination-timeout', {
      run_id: this.runID,
      generation: this.generation,
    })
    this.publishStatus('stopping', 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
  }

  private publishStatus(
    state: Extract<AgentRuntimeStatus['state'], 'running' | 'stopping'>,
    errorCode?: string,
  ) {
    this.publish({
      state,
      active_run_id: this.runID,
      generation: this.generation,
      ...(errorCode ? { error_code: errorCode } : {}),
    })
  }

  private kill() {
    try {
      return this.process.kill()
    } catch (error) {
      this.logger?.error('agent-worker-kill-failed', {
        run_id: this.runID,
        generation: this.generation,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      })
      return false
    }
  }

  private waitForExit(timeoutMs: number) {
    return waitFor(
      this.exitPromise,
      timeoutMs,
      this.setTimeoutImplementation,
      this.clearTimeoutImplementation,
    )
  }

  private dispose() {
    for (const dispose of this.disposers.splice(0)) {
      dispose()
    }
  }
}

function isCurrentSettledMessage(
  message: unknown,
  runID: string,
  generation: number,
) {
  return isAgentWorkerOutboundMessage(message)
    && message.type === 'settled'
    && message.run_id === runID
    && message.generation === generation
}

export function stableAgentRuntimeErrorCode(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0 && code.length <= 128) {
      return code
    }
  }
  if (error instanceof Error && /^AGENT_[A-Z0-9_]+$/.test(error.message)) {
    return error.message
  }
  return fallback
}

async function waitFor(
  promise: Promise<unknown>,
  timeoutMs: number,
  setTimeoutImplementation: typeof globalThis.setTimeout,
  clearTimeoutImplementation: typeof globalThis.clearTimeout,
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeoutImplementation(() => resolve(false), timeoutMs)
        if (typeof timer === 'object' && 'unref' in timer) {
          timer.unref()
        }
      }),
    ])
  } finally {
    if (timer !== null) {
      clearTimeoutImplementation(timer)
    }
  }
}
