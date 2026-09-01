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
  decodeAgentQueueState,
  decodeAgentQueuedTurn,
  decodeAgentQueuedTurnMoveResult,
  decodeAgentQueuedTurnPage,
  decodeAgentAttachment,
  decodeAgentRun,
  decodeAgentRunEventPage,
  decodeAgentSession,
  decodeAgentSessionContext,
  decodeAgentSessionPage,
  decodeAgentSessionUsage,
} from '#features/agent-runtime'
import type {
  AgentRun,
  AgentQueuedTurnMovePlacement,
  AgentSourceContext,
  AgentResourceBindingUpdateInput,
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

  replaceResourceBinding(id: string, input: AgentResourceBindingUpdateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(id)}/resource-binding`, {
      method: 'PUT', body: input, signal,
    }).then(decodeAgentSession)
  }

  removeResourceBinding(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(id)}/resource-binding`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentSession)
  }

  deleteSession(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    })
  }

  uploadAttachment(sessionId: string, file: File, signal?: AbortSignal) {
    const body = new FormData()
    body.append('session_id', sessionId)
    body.append('file', file, file.name)
    return this.request<unknown>(`${agentPath}/attachments`, {
      method: 'POST', body, signal, timeoutMs: 45_000,
    }).then(decodeAgentAttachment)
  }

  attachment(id: string, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/attachments/${encodeURIComponent(id)}`, { signal })
      .then(decodeAgentAttachment)
  }

  attachmentContent(id: string, signal?: AbortSignal) {
    return this.requestBlob(`${agentPath}/attachments/${encodeURIComponent(id)}/content`, {
      signal, timeoutMs: 45_000,
    })
  }

  deleteAttachment(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/attachments/${encodeURIComponent(id)}`, {
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

  queuedTurns(sessionId: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}) {
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) })
    if (options.cursor) query.set('cursor', options.cursor)
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/queued-turns?${query.toString()}`, {
      signal: options.signal,
    }).then(decodeAgentQueuedTurnPage)
  }

  enqueueTurn(sessionId: string, input: {
    client_request_id: string
    prompt: string
    attachment_ids: string[]
    source_context?: AgentSourceContext
    force_context_compression: boolean
  }, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/queued-turns`, {
      method: 'POST', body: input, signal,
    }).then(decodeAgentQueuedTurn)
  }

  beginQueuedTurnEdit(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/queued-turns/${encodeURIComponent(id)}/begin-edit`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentQueuedTurn)
  }

  updateQueuedTurn(id: string, input: { prompt: string; attachment_ids: string[]; expected_revision: number }, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/queued-turns/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: input, signal,
    }).then(decodeAgentQueuedTurn)
  }

  cancelQueuedTurnEdit(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/queued-turns/${encodeURIComponent(id)}/cancel-edit`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentQueuedTurn)
  }

  deleteQueuedTurn(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/queued-turns/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentQueuedTurn)
  }

  moveQueuedTurn(id: string, input: {
    expected_revision: number
    target_turn_id: string
    target_expected_revision: number
    placement: AgentQueuedTurnMovePlacement
  }, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/queued-turns/${encodeURIComponent(id)}/move`, {
      method: 'POST', body: input, signal,
    }).then(decodeAgentQueuedTurnMoveResult)
  }

  steerQueuedTurn(input: {
    turn_id: string
    turn_revision: number
    run_id: string
    run_generation: number
    run_revision: number
  }) {
    return this.requireRuntimeBridge().steerQueuedTurn({
      queued_turn_id: input.turn_id,
      expected_revision: input.turn_revision,
      run_id: input.run_id,
      generation: input.run_generation,
      expected_run_revision: input.run_revision,
    })
  }

  resumeQueue(sessionId: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/queue/resume`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentQueueState)
  }

  wakeQueue() {
    return this.requireRuntimeBridge().wake()
  }

  context(sessionId: string, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/context`, { signal })
      .then((value) => decodeAgentSessionContext(value, sessionId))
  }

  usage(sessionId: string, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/sessions/${encodeURIComponent(sessionId)}/usage`, { signal })
      .then((value) => decodeAgentSessionUsage(value, sessionId))
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

  stopRun(
    id: string,
    expectedRevision: number,
    expectedGeneration: number,
    signal?: AbortSignal,
  ) {
    return this.request<unknown>(`${agentPath}/runs/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: {
        expected_revision: expectedRevision,
        expected_generation: expectedGeneration,
      },
      signal,
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
