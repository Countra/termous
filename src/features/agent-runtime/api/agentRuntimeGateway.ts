import type {
  AgentAttachment,
  AgentMcpPolicy,
  AgentMessagePage,
  AgentReasoningLevel,
  AgentRun,
  AgentRunEventPage,
  AgentSession,
  AgentSessionContext,
  AgentSessionInput,
  AgentSessionPage,
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
  deleteSession(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  uploadAttachment(sessionId: string, file: File, signal?: AbortSignal): Promise<AgentAttachment>
  attachment(id: string, signal?: AbortSignal): Promise<AgentAttachment>
  attachmentContent(id: string, signal?: AbortSignal): Promise<Blob>
  deleteAttachment(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  messages(sessionId: string, options?: AgentMessageListOptions): Promise<AgentMessagePage>
  context(sessionId: string, signal?: AbortSignal): Promise<AgentSessionContext>
  createRun(sessionId: string, input: AgentCreateRunInput, signal?: AbortSignal): Promise<AgentRun>
  run(id: string, signal?: AbortSignal): Promise<AgentRun>
  stopRun(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentRun>
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
