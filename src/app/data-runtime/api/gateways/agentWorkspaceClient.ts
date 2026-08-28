import type {
  AgentRuntimeCommandResult,
  AgentRuntimeStatus,
  AppConfig,
  TermousBridge,
} from '#common/contracts'
import type {
  AgentCreateRunInput,
  AgentMessageListOptions,
  AgentRunEventListOptions,
  AgentSessionListOptions,
  AgentWorkspaceGateway,
} from '#features/agent-runtime'
import {
  decodeAgentMessagePage,
  decodeAgentRun,
  decodeAgentRunEventPage,
  decodeAgentSession,
  decodeAgentSessionPage,
} from '#features/agent-runtime'
import type {
  AgentRun,
  AgentSessionInput,
  AgentSessionUpdateInput,
} from '#entities/agent'
import { getTermousBridge } from '#shared/bridge'
import { AgentSetupClient } from './agentSetupClient.ts'

const agentPath = '/api/v1/agent'
type AgentRuntimeBridge = NonNullable<TermousBridge['agentRuntime']>

export class AgentWorkspaceClient extends AgentSetupClient implements AgentWorkspaceGateway {
  private readonly runtimeBridge?: AgentRuntimeBridge

  constructor(config: Partial<AppConfig> = {}, runtimeBridge = getTermousBridge()?.agentRuntime) {
    super(config)
    this.runtimeBridge = runtimeBridge
  }

  sessions(options: AgentSessionListOptions = {}) {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) })
    if (options.archived !== undefined) query.set('archived', String(options.archived))
    if (options.cursor) query.set('cursor', options.cursor)
    return this.request<unknown>(`${agentPath}/sessions?${query.toString()}`, { signal: options.signal })
      .then(decodeAgentSessionPage)
  }

  session(id: string, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(id)}`, { signal })
      .then(decodeAgentSession)
  }

  createSession(input: AgentSessionInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions`, { method: 'POST', body: input, signal })
      .then(decodeAgentSession)
  }

  updateSession(id: string, input: AgentSessionUpdateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: input, signal,
    }).then(decodeAgentSession)
  }

  deleteSession(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    })
  }

  messages(sessionId: string, options: AgentMessageListOptions = {}) {
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) })
    if (options.afterSequence !== undefined) query.set('after_sequence', String(options.afterSequence))
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`, {
      signal: options.signal,
    }).then(decodeAgentMessagePage)
  }

  createRun(sessionId: string, input: AgentCreateRunInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/runs`, {
      method: 'POST', body: input, signal,
    }).then(decodeAgentRun)
  }

  run(id: string, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/runs/${encodeURIComponent(id)}`, { signal })
      .then(decodeAgentRun)
  }

  stopRun(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/runs/${encodeURIComponent(id)}/stop`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentRun)
  }

  runEvents(id: string, options: AgentRunEventListOptions) {
    const query = new URLSearchParams({
      generation: String(options.generation),
      after_sequence: String(options.afterSequence ?? 0),
      limit: String(options.limit ?? 200),
    })
    return this.request<unknown>(`${agentPath}/runs/${encodeURIComponent(id)}/events?${query.toString()}`, {
      signal: options.signal,
    }).then(decodeAgentRunEventPage)
  }

  eventsUrl() {
    return this.websocketUrl(`${agentPath}/events`)
  }

  runtimeStatus() {
    return this.requireRuntimeBridge().getStatus()
  }

  startRuntime(run: Pick<AgentRun, 'id' | 'generation'>): Promise<AgentRuntimeCommandResult> {
    return this.requireRuntimeBridge().start({ run_id: run.id, generation: run.generation })
  }

  stopRuntime(run: Pick<AgentRun, 'id' | 'generation'>): Promise<AgentRuntimeCommandResult> {
    return this.requireRuntimeBridge().stop({ run_id: run.id, generation: run.generation })
  }

  steerRuntime(run: Pick<AgentRun, 'id' | 'generation'>, message: string): Promise<AgentRuntimeCommandResult> {
    return this.requireRuntimeBridge().steer({ run_id: run.id, generation: run.generation, message })
  }

  onRuntimeStatus(callback: (status: AgentRuntimeStatus) => void) {
    return this.requireRuntimeBridge().onStatus(callback)
  }

  private requireRuntimeBridge() {
    if (!this.runtimeBridge) throw new Error('AGENT_RUNTIME_BRIDGE_UNAVAILABLE')
    return this.runtimeBridge
  }
}
