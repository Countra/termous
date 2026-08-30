import type { AgentWorkerStartMessage } from './protocol.ts'
import { isRecord, validGeneration } from './protocol.ts'
import {
  isRuntimeMessageAttachmentList,
  type RuntimeMessageAttachment,
} from './runtimeAttachmentPolicy.ts'

const bootstrapPath = '/api/v1/agent/runtime/bootstrap'
export const agentRuntimeRequestTimeoutMs = 15_000
export const agentRuntimeBootstrapRequestTimeoutMs = 60_000

export type AgentRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface RuntimeModelSnapshot {
  api_mode: 'responses' | 'chat_completions'
  base_url: string
  model_id: string
  provider_id: string
  provider_name: string
  model_display_name: string
  provider_revision: number
  model_revision: number
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  reasoning_control: 'none' | 'openai_effort'
  supported_reasoning_levels: RuntimeReasoningLevel[]
}

export type RuntimeReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface RuntimeMessagePart {
  id: string
  message_id: string
  kind: 'text' | 'reasoning' | 'tool_call' | 'tool_result'
  sequence: number
  content: Record<string, unknown>
}

export interface RuntimeMessageView {
  id: string
  role: 'user' | 'assistant'
  status: string
  sequence: number
  created_at: string
  parts: RuntimeMessagePart[]
  attachments: RuntimeMessageAttachment[]
}

export interface RuntimeBootstrap {
  core_instance_id: string
  run: {
    id: string
    session_id: string
    generation: number
    event_sequence: number
    status: AgentRunStatus
    assistant_message_id: string
    provider_id: string
    model_id: string
    reasoning_level: RuntimeReasoningLevel
  }
  session: {
    id: string
  }
  messages: RuntimeMessageView[]
  runtime_bearer: string
  mcp: {
    endpoint: string
    bearer_token: string
    protocol_version: string
  }
  model: {
    snapshot: RuntimeModelSnapshot
    api_key?: string
  }
  context: RuntimeContextBootstrap
}

export interface RuntimeContextCheckpoint {
  boundary_message_sequence: number
  summary: string
  estimated_tokens: number
}

export interface RuntimeContextCompression {
  boundary_message_sequence: number
  source_hash: string
  estimated_tokens: number
}

export interface RuntimeContextBootstrap {
  estimated_tokens: number
  warning: boolean
  checkpoint?: RuntimeContextCheckpoint
  compression?: RuntimeContextCompression
}

export interface RuntimeCheckpointInput {
  generation: number
  boundary_message_sequence: number
  source_hash: string
  summary: string
}

export type RuntimeEventKind =
  | 'status'
  | 'message_delta'
  | 'message_part'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'usage'
  | 'error'

export interface RuntimeEventInput {
  event_id: string
  generation: number
  sequence: number
  kind: RuntimeEventKind
  payload: Record<string, unknown>
}

export interface RuntimeSteerInput {
  event_id: string
  sequence: number
  client_request_id: string
  text: string
}

export interface WorkerCoreClientPort {
  bootstrap(start: AgentWorkerStartMessage, signal?: AbortSignal): Promise<RuntimeBootstrap>
  appendEvents(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    events: RuntimeEventInput[],
  ): Promise<number>
  appendSteer(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeSteerInput,
  ): Promise<number>
  commitCheckpoint(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ): Promise<RuntimeContextCheckpoint>
}

export interface WorkerCoreClientOptions {
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  bootstrapRequestTimeoutMs?: number
}

export class WorkerCoreClient implements WorkerCoreClientPort {
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly requestTimeoutMs: number
  private readonly bootstrapRequestTimeoutMs: number

  constructor(options: WorkerCoreClientOptions = {}) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? agentRuntimeRequestTimeoutMs
    this.bootstrapRequestTimeoutMs = options.bootstrapRequestTimeoutMs
      ?? agentRuntimeBootstrapRequestTimeoutMs
  }

  async bootstrap(start: AgentWorkerStartMessage, signal?: AbortSignal) {
    const value = await this.request(
      start.core_base_url,
      bootstrapPath,
      {
        method: 'POST',
        body: JSON.stringify({ ticket: start.ticket }),
      },
      undefined,
      signal,
      this.bootstrapRequestTimeoutMs,
    )
    if (!isRuntimeBootstrap(value, start)) {
      throw new WorkerCoreError('AGENT_RUNTIME_BOOTSTRAP_INVALID')
    }
    // Run 模型快照只允许在 Core 创建任务时确定，Worker 后续阶段不得改写。
    Object.freeze(value.model.snapshot)
    return value
  }

  async appendEvents(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    events: RuntimeEventInput[],
  ) {
    if (events.length === 0 || events.length > 64) {
      throw new WorkerCoreError('AGENT_RUNTIME_EVENT_BATCH_INVALID')
    }
    const value = await this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-events`,
      {
        method: 'POST',
        body: JSON.stringify({
          generation: start.generation,
          events,
        }),
      },
      runtimeBearer,
    )
    const expectedSequence = events[events.length - 1]?.sequence
    if (!isRecord(value)
      || value.last_sequence !== expectedSequence
      || !validGeneration(value.last_sequence)) {
      throw new WorkerCoreError('AGENT_RUNTIME_EVENT_RESPONSE_INVALID')
    }
    return value.last_sequence
  }

  async appendSteer(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeSteerInput,
  ) {
    if (!validRuntimeSteerInput(input)) {
      throw new WorkerCoreError('AGENT_RUNTIME_STEER_INVALID')
    }
    const value = await this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-steers`,
      {
        method: 'POST',
        body: JSON.stringify({
          generation: start.generation,
          ...input,
        }),
      },
      runtimeBearer,
    )
    if (!isRecord(value)
      || value.last_sequence !== input.sequence
      || !validGeneration(value.last_sequence)) {
      throw new WorkerCoreError('AGENT_RUNTIME_STEER_RESPONSE_INVALID')
    }
    return value.last_sequence
  }

  async commitCheckpoint(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ) {
    if (!isRuntimeCheckpointInput(input, start.generation)) {
      throw new WorkerCoreError('AGENT_RUNTIME_CHECKPOINT_INVALID')
    }
    const value = await this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-checkpoints`,
      { method: 'POST', body: JSON.stringify(input) },
      runtimeBearer,
      signal,
    )
    if (!isRecord(value) || !isRuntimeContextCheckpoint(value.checkpoint)
      || value.checkpoint.boundary_message_sequence !== input.boundary_message_sequence
      || value.checkpoint.summary !== input.summary) {
      throw new WorkerCoreError('AGENT_RUNTIME_CHECKPOINT_RESPONSE_INVALID')
    }
    return value.checkpoint
  }

  private async request(
    coreBaseURL: string,
    pathname: string,
    init: RequestInit,
    bearer?: string,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ) {
    const baseURL = validateCoreBaseURL(coreBaseURL)
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', forwardAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await this.fetchImplementation(new URL(pathname, baseURL), {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      })
      if (!response.ok) {
        throw new WorkerCoreError(await responseErrorCode(response), response.status)
      }
      return await response.json() as unknown
    } catch (error) {
      if (error instanceof WorkerCoreError) {
        throw error
      }
      throw new WorkerCoreError(
        controller.signal.aborted
          ? 'AGENT_RUNTIME_REQUEST_ABORTED'
          : 'AGENT_RUNTIME_UNAVAILABLE',
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

export class WorkerCoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status = 0) {
    super(code)
    this.name = 'WorkerCoreError'
    this.code = code
    this.status = status
  }
}

function validateCoreBaseURL(value: string) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1'
    || host === 'localhost'
    || host === '[::1]'
    || host === '::1'
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) {
    throw new WorkerCoreError('AGENT_RUNTIME_CORE_URL_INVALID')
  }
  return url
}

function isRuntimeBootstrap(value: unknown, start: AgentWorkerStartMessage): value is RuntimeBootstrap {
  if (!isRecord(value)
    || typeof value.core_instance_id !== 'string'
    || value.core_instance_id.length === 0
    || value.core_instance_id.length > 256
    || !isRecord(value.run)
    || value.run.id !== start.run_id
    || typeof value.run.session_id !== 'string'
    || value.run.session_id.length === 0
    || value.run.generation !== start.generation
    || !validGeneration(value.run.generation)
    || !Number.isSafeInteger(value.run.event_sequence)
    || Number(value.run.event_sequence) < 0
    || value.run.status !== 'starting'
    || typeof value.run.assistant_message_id !== 'string'
    || value.run.assistant_message_id.length === 0
    || value.run.assistant_message_id.length > 128
    || typeof value.run.provider_id !== 'string'
    || value.run.provider_id.length === 0
    || value.run.provider_id.length > 128
    || typeof value.run.model_id !== 'string'
    || value.run.model_id.length === 0
    || value.run.model_id.length > 128
    || !validReasoningLevel(value.run.reasoning_level)
    || !isRecord(value.session)
    || value.session.id !== value.run.session_id
    || !Array.isArray(value.messages)
    || !value.messages.every(isRuntimeMessageView)
    || typeof value.runtime_bearer !== 'string'
    || value.runtime_bearer.length < 40
    || value.runtime_bearer.length > 4096
    || !isRecord(value.mcp)
    || typeof value.mcp.endpoint !== 'string'
    || typeof value.mcp.bearer_token !== 'string'
    || value.mcp.bearer_token.length < 40
    || value.mcp.bearer_token.length > 4096
    || typeof value.mcp.protocol_version !== 'string'
    || !isRecord(value.model)
    || !isRuntimeModelSnapshot(value.model.snapshot)
    || value.model.snapshot.provider_id !== value.run.provider_id
    || !value.model.snapshot.supported_reasoning_levels.includes(value.run.reasoning_level)
    || !isRuntimeContextBootstrap(value.context)) {
    return false
  }
  return value.model.api_key === undefined
    || (typeof value.model.api_key === 'string'
      && value.model.api_key.length > 0
      && value.model.api_key.length <= 16 * 1024)
}

function isRuntimeContextBootstrap(value: unknown): value is RuntimeContextBootstrap {
  return isRecord(value)
    && Number.isSafeInteger(value.estimated_tokens)
    && Number(value.estimated_tokens) >= 0
    && typeof value.warning === 'boolean'
    && (value.checkpoint === undefined || isRuntimeContextCheckpoint(value.checkpoint))
    && (value.compression === undefined || isRuntimeContextCompression(value.compression))
}

function isRuntimeContextCheckpoint(value: unknown): value is RuntimeContextCheckpoint {
  return isRecord(value)
    && Number.isSafeInteger(value.boundary_message_sequence)
    && Number(value.boundary_message_sequence) > 0
    && typeof value.summary === 'string'
    && value.summary.trim().length > 0
    && Buffer.byteLength(value.summary, 'utf8') <= 256 * 1024
    && Number.isSafeInteger(value.estimated_tokens)
    && Number(value.estimated_tokens) >= 0
}

function isRuntimeContextCompression(value: unknown): value is RuntimeContextCompression {
  return isRecord(value)
    && Number.isSafeInteger(value.boundary_message_sequence)
    && Number(value.boundary_message_sequence) > 0
    && typeof value.source_hash === 'string'
    && /^[0-9a-f]{64}$/u.test(value.source_hash)
    && Number.isSafeInteger(value.estimated_tokens)
    && Number(value.estimated_tokens) >= 0
}

function isRuntimeCheckpointInput(value: RuntimeCheckpointInput, generation: number) {
  return value.generation === generation
    && isRuntimeContextCompression({
      boundary_message_sequence: value.boundary_message_sequence,
      source_hash: value.source_hash,
      estimated_tokens: 0,
    })
    && typeof value.summary === 'string'
    && value.summary.trim().length > 0
    && Buffer.byteLength(value.summary, 'utf8') <= 256 * 1024
}

function isRuntimeMessageView(value: unknown): value is RuntimeMessageView {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) > 0
    && typeof value.created_at === 'string'
    && Array.isArray(value.parts)
    && value.parts.every(isRuntimeMessagePart)
    && isRuntimeMessageAttachmentList(value.attachments)
}

function isRuntimeMessagePart(value: unknown): value is RuntimeMessagePart {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.message_id === 'string'
    && (value.kind === 'text'
      || value.kind === 'reasoning'
      || value.kind === 'tool_call'
      || value.kind === 'tool_result')
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) > 0
    && isRecord(value.content)
}

function isRuntimeModelSnapshot(value: unknown): value is RuntimeModelSnapshot {
  return isRecord(value)
    && (value.api_mode === 'responses' || value.api_mode === 'chat_completions')
    && typeof value.base_url === 'string'
    && validProviderBaseURL(value.base_url)
    && typeof value.model_id === 'string'
    && value.model_id.length > 0
    && value.model_id.length <= 512
    && typeof value.provider_id === 'string'
    && value.provider_id.length > 0
    && value.provider_id.length <= 128
    && typeof value.provider_name === 'string'
    && value.provider_name.length > 0
    && value.provider_name.length <= 256
    && typeof value.model_display_name === 'string'
    && value.model_display_name.length > 0
    && value.model_display_name.length <= 512
    && Number.isSafeInteger(value.provider_revision)
    && Number(value.provider_revision) > 0
    && Number.isSafeInteger(value.model_revision)
    && Number(value.model_revision) > 0
    && Number.isSafeInteger(value.context_window_tokens)
    && Number(value.context_window_tokens) >= 1_024
    && Number(value.context_window_tokens) <= 2_000_000
    && Number.isSafeInteger(value.max_output_tokens)
    && Number(value.max_output_tokens) > 0
    && Number(value.max_output_tokens) <= Number(value.context_window_tokens)
    && typeof value.supports_images === 'boolean'
    && validReasoningConfiguration(value.reasoning_control, value.supported_reasoning_levels)
}

function validProviderBaseURL(value: string) {
  if (value.length === 0 || value.length > 2_048) {
    return false
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function validReasoningLevel(value: unknown): value is RuntimeBootstrap['run']['reasoning_level'] {
  return value === 'off'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
}

function validReasoningConfiguration(
  control: unknown,
  levels: unknown,
): levels is RuntimeReasoningLevel[] {
  if ((control !== 'none' && control !== 'openai_effort')
    || !Array.isArray(levels)
    || levels.length === 0
    || !levels.every(validReasoningLevel)
    || new Set(levels).size !== levels.length) {
    return false
  }
  return control === 'none'
    ? levels.length === 1 && levels[0] === 'off'
    : levels.some((level) => level !== 'off')
}

function validRuntimeSteerInput(value: RuntimeSteerInput) {
  return typeof value.event_id === 'string'
    && value.event_id.length > 0
    && value.event_id.length <= 128
    && Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && typeof value.client_request_id === 'string'
    && value.client_request_id.length > 0
    && value.client_request_id.length <= 128
    && typeof value.text === 'string'
    && value.text.trim().length > 0
    && Buffer.byteLength(value.text, 'utf8') <= 1 << 20
}

async function responseErrorCode(response: Response) {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) {
      if (typeof value.code === 'string' && value.code.length <= 128) {
        return value.code
      }
      if (isRecord(value.error)
        && typeof value.error.code === 'string'
        && value.error.code.length <= 128) {
        return value.error.code
      }
    }
  } catch {
    // 错误响应可能没有 JSON 正文，只返回稳定 HTTP 分类。
  }
  return `AGENT_RUNTIME_HTTP_${response.status}`
}
