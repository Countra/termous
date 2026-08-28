import type {
  AgentMcpPolicy,
  AgentMessagePage,
  AgentModelProfilePage,
  AgentReasoningLevel,
  AgentRun,
  AgentRunEventPage,
  AgentSession,
  AgentSessionInput,
  AgentSessionPage,
  AgentSessionUpdateInput,
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
}

export interface AgentWorkspaceGateway {
  sessions(options?: AgentSessionListOptions): Promise<AgentSessionPage>
  session(id: string, signal?: AbortSignal): Promise<AgentSession>
  createSession(input: AgentSessionInput, signal?: AbortSignal): Promise<AgentSession>
  updateSession(id: string, input: AgentSessionUpdateInput, signal?: AbortSignal): Promise<AgentSession>
  deleteSession(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  messages(sessionId: string, options?: AgentMessageListOptions): Promise<AgentMessagePage>
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
  modelProfiles(cursor?: string, signal?: AbortSignal): Promise<AgentModelProfilePage>
  updateMcpPolicy(input: {
    approval_bypass: boolean
    sync_scopes: boolean
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentMcpPolicy>
}

export interface AgentWorkspaceSessionDefaults {
  modelProfileId: string
  reasoningLevel: AgentReasoningLevel
}
