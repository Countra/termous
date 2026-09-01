import type {
  AgentAttachment,
  AgentMcpPolicy,
  AgentMessagePage,
  AgentQueueState,
  AgentQueuedTurn,
  AgentQueuedTurnMovePlacement,
  AgentQueuedTurnMoveResult,
  AgentQueuedTurnPage,
  AgentReasoningLevel,
  AgentRun,
  AgentRunEventPage,
  AgentResourceBindingUpdateInput,
  AgentSession,
  AgentSessionContext,
  AgentSessionInput,
  AgentSessionPage,
  AgentSessionUsage,
  AgentSessionUpdateInput,
  AgentSourceContext,
} from '#entities/agent'
import type { AgentRuntimeCommandResult, AgentRuntimeStatus } from '#common/contracts'

export interface AgentSessionListOptions {
  archived?: boolean
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface AgentMessageListOptions {
  afterSequence?: number
  limit?: number
  signal?: AbortSignal
}

export interface AgentRunEventListOptions {
  generation: number
  afterSequence?: number
  limit?: number
  signal?: AbortSignal
}

export interface AgentCreateRunInput {
  client_request_id: string
  prompt: string
  attachment_ids: string[]
  source_context?: AgentSourceContext
  force_context_compression: boolean
}

export interface AgentWorkspaceGateway {
  sessions(options?: AgentSessionListOptions): Promise<AgentSessionPage>
  session(id: string, signal?: AbortSignal): Promise<AgentSession>
  createSession(input: AgentSessionInput, signal?: AbortSignal): Promise<AgentSession>
  updateSession(id: string, input: AgentSessionUpdateInput, signal?: AbortSignal): Promise<AgentSession>
  replaceResourceBinding(id: string, input: AgentResourceBindingUpdateInput, signal?: AbortSignal): Promise<AgentSession>
  removeResourceBinding(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentSession>
  deleteSession(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  uploadAttachment(sessionId: string, file: File, signal?: AbortSignal): Promise<AgentAttachment>
  attachment(id: string, signal?: AbortSignal): Promise<AgentAttachment>
  attachmentContent(id: string, signal?: AbortSignal): Promise<Blob>
  deleteAttachment(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  messages(sessionId: string, options?: AgentMessageListOptions): Promise<AgentMessagePage>
  queuedTurns(sessionId: string, options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<AgentQueuedTurnPage>
  enqueueTurn(sessionId: string, input: {
    client_request_id: string
    prompt: string
    attachment_ids: string[]
    source_context?: AgentSourceContext
    force_context_compression: boolean
  }, signal?: AbortSignal): Promise<AgentQueuedTurn>
  beginQueuedTurnEdit(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentQueuedTurn>
  updateQueuedTurn(id: string, input: {
    prompt: string
    attachment_ids: string[]
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentQueuedTurn>
  cancelQueuedTurnEdit(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentQueuedTurn>
  deleteQueuedTurn(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentQueuedTurn>
  moveQueuedTurn(id: string, input: {
    expected_revision: number
    target_turn_id: string
    target_expected_revision: number
    placement: AgentQueuedTurnMovePlacement
  }, signal?: AbortSignal): Promise<AgentQueuedTurnMoveResult>
  steerQueuedTurn(input: {
    turn_id: string
    turn_revision: number
    run_id: string
    run_generation: number
    run_revision: number
  }): Promise<AgentRuntimeCommandResult>
  resumeQueue(sessionId: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentQueueState>
  wakeQueue(): Promise<AgentRuntimeCommandResult>
  context(sessionId: string, signal?: AbortSignal): Promise<AgentSessionContext>
  usage(sessionId: string, signal?: AbortSignal): Promise<AgentSessionUsage>
  createRun(sessionId: string, input: AgentCreateRunInput, signal?: AbortSignal): Promise<AgentRun>
  run(id: string, signal?: AbortSignal): Promise<AgentRun>
  stopRun(
    id: string,
    expectedRevision: number,
    expectedGeneration: number,
    signal?: AbortSignal,
  ): Promise<AgentRun>
  runEvents(id: string, options: AgentRunEventListOptions): Promise<AgentRunEventPage>
  eventsUrl(): string
  runtimeStatus(): Promise<AgentRuntimeStatus>
  startRuntime(run: Pick<AgentRun, 'id' | 'generation'>): Promise<AgentRuntimeCommandResult>
  stopRuntime(run: Pick<AgentRun, 'id' | 'generation'>): Promise<AgentRuntimeCommandResult>
  steerRuntime(run: Pick<AgentRun, 'id' | 'generation'>, message: string): Promise<AgentRuntimeCommandResult>
  onRuntimeStatus(callback: (status: AgentRuntimeStatus) => void): () => void
  updateMcpPolicy(input: {
    approval_bypass: boolean
    sync_scopes: boolean
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentMcpPolicy>
}

export interface AgentWorkspaceSessionDefaults {
  modelId: string
  reasoningLevel: AgentReasoningLevel
}
