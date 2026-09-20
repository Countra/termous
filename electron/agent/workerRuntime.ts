import { readSkillResourceToolName } from './skillBundle.ts'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import {
  connectAgentMCP,
  type AgentMCPConnection,
  type ConnectAgentMCPOptions,
} from './mcpClientAdapter.ts'
import {
  createPiAgent,
  type CreatePiAgentOptions,
  type PiAgentController,
} from './piAgentAdapter.ts'
import type {
  AgentWorkerInboundMessage,
  AgentWorkerOutboundMessage,
  AgentWorkerStartMessage,
} from './protocol.ts'
import {
  isRecord,
  validAgentWorkerStartMessage,
  validClientRequestID,
  validGeneration,
  validRunID,
} from './protocol.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { RuntimeAuditWriter } from './runtimeAuditWriter.ts'
import { projectWorkerMCPFailure } from './workerMCPFailure.ts'
import {
  WorkerCoreClient,
  type RuntimeBootstrap,
  type WorkerCoreClientPort,
} from './workerCoreClient.ts'

const maximumSteerBytes = 1 << 20
const maximumPendingSteers = 32

export interface AgentWorkerRuntimeOptions {
  send: (message: AgentWorkerOutboundMessage) => void
  finish: () => void
  core?: WorkerCoreClientPort
  connectMCP?: (options: ConnectAgentMCPOptions) => Promise<AgentMCPConnection>
  createAgent?: (options: CreatePiAgentOptions) => PiAgentController
}

interface PendingSteer {
  clientRequestID: string
  text: string
}

export class AgentWorkerRuntime {
  private readonly send: (message: AgentWorkerOutboundMessage) => void
  private readonly finish: () => void
  private readonly core: WorkerCoreClientPort
  private readonly connectMCP: (options: ConnectAgentMCPOptions) => Promise<AgentMCPConnection>
  private readonly createAgent: (options: CreatePiAgentOptions) => PiAgentController
  private readonly startupAbort = new AbortController()
  private readonly pendingSteers: PendingSteer[] = []
  private startMessage: AgentWorkerStartMessage | null = null
  private bootstrap: RuntimeBootstrap | null = null
  private events: RuntimeEventWriter | null = null
  private audit: RuntimeAuditWriter | null = null
  private mcp: AgentMCPConnection | null = null
  private agent: PiAgentController | null = null
  private steerTail: Promise<void> = Promise.resolve()
  private abortRequested = false
  private runtimeFailure: unknown = null
  private executionStarted = false
  private steerIntakeOpen = true
  private finished = false

  constructor(options: AgentWorkerRuntimeOptions) {
    this.send = options.send
    this.finish = options.finish
    this.core = options.core ?? new WorkerCoreClient()
    this.connectMCP = options.connectMCP ?? connectAgentMCP
    this.createAgent = options.createAgent ?? createPiAgent
  }

  handleMessage(value: unknown) {
    const message = parseInboundMessage(value)
    if (!message || this.finished) {
      return
    }
    if (message.type === 'start') {
      this.handleStart(message)
      return
    }
    if (!this.startMessage || !matchesRun(this.startMessage, message)) {
      return
    }
    if (message.type === 'abort') {
      this.abortRequested = true
      this.steerIntakeOpen = false
      this.rejectPendingSteers('AGENT_RUNTIME_RUN_NOT_ACTIVE')
      this.startupAbort.abort()
      this.agent?.abort()
      return
    }
    if (!this.steerIntakeOpen) {
      this.acknowledgeSteer(message.client_request_id, false, 'AGENT_RUNTIME_STEER_CLOSED')
      return
    }
    const pending = {
      clientRequestID: message.client_request_id,
      text: message.message,
    }
    if (!this.agent || !this.events || !this.bootstrap || !this.startMessage) {
      if (this.pendingSteers.length >= maximumPendingSteers) {
        this.acknowledgeSteer(pending.clientRequestID, false, 'AGENT_RUNTIME_STEER_QUEUE_FULL')
        this.failRuntime(new Error('AGENT_RUNTIME_STEER_QUEUE_FULL'))
        return
      }
      this.pendingSteers.push(pending)
      return
    }
    this.enqueueSteer(pending)
  }

  private handleStart(message: AgentWorkerStartMessage) {
    if (this.executionStarted) {
      return
    }
    this.executionStarted = true
    this.startMessage = message
    void this.execute(message)
  }

  private async execute(start: AgentWorkerStartMessage) {
    let settled: 'completed' | 'cancelled' | 'failed' | null = null
    let fatal: 'bootstrap_failed' | 'runtime_failed' | null = null
    try {
      // start 已签发一次性 Ticket 后必须尝试消费；取消由 bootstrap 后的终态事件收口。
      const bootstrap = await this.core.bootstrap(start)
      this.bootstrap = bootstrap
      this.events = new RuntimeEventWriter({
        core: this.core,
        start,
        runtimeBearer: bootstrap.runtime_bearer,
        initialSequence: bootstrap.run.event_sequence,
        onFailure: (error) => this.failRuntime(error),
      })
      if (this.abortRequested) {
        settled = await this.persistTerminalStatus('cancelled')
        return
      }
      this.mcp = await this.connectMCP({
        coreBaseURL: start.core_base_url,
        endpoint: bootstrap.mcp.endpoint,
        bearerToken: bootstrap.mcp.bearer_token,
        protocolVersion: bootstrap.mcp.protocol_version,
        signal: this.startupAbort.signal,
      })
      if (this.abortRequested) {
        settled = await this.persistTerminalStatus('cancelled')
        return
      }
      this.audit = new RuntimeAuditWriter({
        submit: (events, signal) => this.core.appendAuditEvents(start, bootstrap.runtime_bearer, events, signal),
        isCancelled: () => this.abortRequested,
        originalName: (name) => this.mcp?.originalName(name) ?? (name === readSkillResourceToolName ? name : null),
      })
      this.agent = this.createAgent({
        audit: this.audit,
        bootstrap,
        mcp: this.mcp,
        events: this.events,
        skills: start.skills,
        commitCheckpoint: (input, signal) => this.core.commitCheckpoint(
          start, bootstrap.runtime_bearer, input, signal,
        ),
        onFailure: (error) => this.failRuntime(error),
      })
      this.events.push('status', { status: { status: 'running' } })
      await this.events.flush()
      if (this.abortRequested) {
        settled = await this.persistTerminalStatus('cancelled')
        return
      }
      this.send(workerMessage(start, { type: 'started' }))
      for (const steer of this.pendingSteers.splice(0)) {
        this.enqueueSteer(steer)
      }

      let outcome = await this.agent.continue()
      while (!this.abortRequested) {
        await this.freezeSteerIntake()
        if (outcome !== 'completed' || this.runtimeFailure !== null || !this.agent.hasQueuedMessages()) {
          break
        }
        this.steerIntakeOpen = true
        outcome = await this.agent.continue()
      }
      if (this.runtimeFailure !== null) {
        fatal = 'runtime_failed'
        return
      }
      settled = await this.persistTerminalStatus(
        this.abortRequested ? 'cancelled' : outcome,
      )
    } catch (error) {
      if (this.bootstrap === null) {
        fatal = 'bootstrap_failed'
        return
      }
      if (this.runtimeFailure !== null) {
        fatal = 'runtime_failed'
        return
      }
      if (this.abortRequested) {
        try {
          settled = await this.persistTerminalStatus('cancelled')
        } catch {
          fatal = 'runtime_failed'
        }
        return
      }
      try {
        this.events?.push('error', {
          error: this.mcp === null ? projectWorkerMCPFailure(error) : {
            code: 'AGENT_RUNTIME_EXECUTION_FAILED',
            message: 'AI 助手执行运行时失败',
          },
        })
        settled = await this.persistTerminalStatus('failed')
      } catch {
        fatal = 'runtime_failed'
      }
    } finally {
      if (fatal) {
        this.safeSend(workerMessage(start, { type: 'fatal', category: fatal }))
      } else if (settled) {
        this.safeSend(workerMessage(start, { type: 'settled', outcome: settled }))
      } else {
        this.safeSend(workerMessage(start, {
          type: 'fatal',
          category: this.bootstrap ? 'runtime_failed' : 'bootstrap_failed',
        }))
      }
      // 终态写入完成后先通知主进程，使资源关闭异常仍受退出守卫约束。
      await this.closeResources()
      this.finishOnce()
    }
  }

  private enqueueSteer(value: PendingSteer) {
    const operation = this.steerTail.then(async () => {
      if (this.abortRequested || this.runtimeFailure !== null) {
        this.acknowledgeSteer(value.clientRequestID, false, 'AGENT_RUNTIME_STEER_CLOSED')
        return
      }
      const start = this.startMessage
      const bootstrap = this.bootstrap
      const events = this.events
      const agent = this.agent
      if (!start || !bootstrap || !events || !agent) {
        throw new Error('AGENT_RUNTIME_STEER_UNAVAILABLE')
      }
      let persisted: Awaited<ReturnType<WorkerCoreClientPort['appendSteer']>>
      try {
        persisted = await events.writeExternal(async (eventID, sequence) => {
          const result = await this.core.appendSteer(
            start,
            bootstrap.runtime_bearer,
            {
              event_id: eventID,
              sequence,
              client_request_id: value.clientRequestID,
              text: value.text,
            },
          )
          return { lastSequence: result.last_sequence, value: result }
        })
      } catch (error) {
        this.acknowledgeSteer(value.clientRequestID, false, 'AGENT_RUNTIME_STEER_PERSIST_FAILED')
        throw error
      }
      // pi 必须携带已落库消息身份，消费时才能记录准确的恢复顺序。
      this.acknowledgeSteer(value.clientRequestID, true)
      if (!this.abortRequested) agent.steer(value.text, persisted)
    })
    this.steerTail = operation.catch((error) => {
      this.failRuntime(error)
    })
  }

  private async freezeSteerIntake() {
    while (true) {
      const observedTail = this.steerTail
      await observedTail
      if (observedTail !== this.steerTail) {
        continue
      }
      this.steerIntakeOpen = false
      if (observedTail === this.steerTail) {
        return
      }
      this.steerIntakeOpen = true
    }
  }

  private async persistTerminalStatus(
    outcome: 'completed' | 'cancelled' | 'failed',
  ) {
    await this.audit?.close()
    const events = this.events
    if (!events) {
      return outcome
    }
    events.push('status', { status: { status: outcome } })
    await events.flush()
    return outcome
  }

  private failRuntime(error: unknown) {
    if (this.runtimeFailure === null) {
      this.runtimeFailure = error
    }
    this.steerIntakeOpen = false
    this.rejectPendingSteers('AGENT_RUNTIME_STEER_CLOSED')
    this.startupAbort.abort()
    this.agent?.abort()
  }

  private async closeResources() {
    this.rejectPendingSteers('AGENT_RUNTIME_STEER_CLOSED')
    this.agent?.abort()
    await this.agent?.waitForIdle().catch(() => undefined)
    await this.audit?.close()
    this.audit = null
    this.agent?.close()
    this.agent = null
    await this.steerTail.catch(() => undefined)
    await this.events?.close().catch(() => undefined)
    this.events = null
    await this.mcp?.close().catch(() => undefined)
    this.mcp = null
    this.bootstrap = null
  }

  private rejectPendingSteers(errorCode: string) {
    for (const steer of this.pendingSteers.splice(0)) {
      this.acknowledgeSteer(steer.clientRequestID, false, errorCode)
    }
  }

  private acknowledgeSteer(
    clientRequestID: string,
    accepted: boolean,
    errorCode?: string,
  ) {
    const start = this.startMessage
    if (!start) return
    this.safeSend(workerMessage(start, {
      type: 'steer_ack',
      client_request_id: clientRequestID,
      accepted,
      ...(accepted ? {} : { error_code: errorCode ?? 'AGENT_RUNTIME_STEER_CLOSED' }),
    }))
  }

  private safeSend(message: AgentWorkerOutboundMessage) {
    try {
      this.send(message)
    } catch {
      // 父进程可能已退出，此时只需继续本地资源回收。
    }
  }

  private finishOnce() {
    if (this.finished) {
      return
    }
    this.finished = true
    try {
      this.finish()
    } catch {
      // utilityProcess 即将自然退出，不再引入新的失败路径。
    }
  }
}

function parseInboundMessage(value: unknown): AgentWorkerInboundMessage | null {
  if (!isRecord(value) || !validRunID(value.run_id) || !validGeneration(value.generation)) {
    return null
  }
  if (value.type === 'start') {
    return validAgentWorkerStartMessage(value) ? value : null
  }
  if (value.type === 'abort') {
    return {
      type: 'abort',
      run_id: value.run_id,
      generation: value.generation,
    }
  }
  if (value.type === 'steer'
    && validClientRequestID(value.client_request_id)
    && typeof value.message === 'string'
    && value.message.trim() !== ''
    && Buffer.byteLength(value.message, 'utf8') <= maximumSteerBytes) {
    return {
      type: 'steer',
      run_id: value.run_id,
      generation: value.generation,
      client_request_id: value.client_request_id,
      message: value.message,
    }
  }
  return null
}

function matchesRun(
  start: AgentWorkerStartMessage,
  message: Exclude<AgentWorkerInboundMessage, AgentWorkerStartMessage>,
) {
  return start.run_id === message.run_id && start.generation === message.generation
}

function workerMessage<T extends
  | { type: 'started' }
  | { type: 'settled'; outcome: 'completed' | 'cancelled' | 'failed' }
  | { type: 'fatal'; category: 'bootstrap_failed' | 'runtime_failed' }
  | { type: 'steer_ack'; client_request_id: string; accepted: boolean; error_code?: string }>(
  start: AgentWorkerStartMessage,
  value: T,
) {
  return {
    ...value,
    protocol_version: agentRuntimeProtocolVersion,
    run_id: start.run_id,
    generation: start.generation,
  } as AgentWorkerOutboundMessage
}
