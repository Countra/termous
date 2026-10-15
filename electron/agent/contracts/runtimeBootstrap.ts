import { isRecord, validGeneration } from './validation.ts'
import type { AgentWorkerStartMessage } from './protocol.ts'
import { isRuntimeModelSnapshot, validReasoningLevel, type RuntimeModelSnapshot, type RuntimeReasoningLevel } from './modelSnapshot.ts'
import { isRuntimeResourceBindings, type RuntimeResourceBinding } from './resourceBindings.ts'
import { isRuntimeMessageAttachmentList, type RuntimeMessageAttachment } from './runtimeAttachmentPolicy.ts'
import { isRuntimeProviderUsage, type RuntimeProviderUsage } from './providerUsageContract.ts'
import { isRuntimeContextCheckpoint, type RuntimeContextCheckpoint } from './runtimeCheckpoint.ts'

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
  provider_usage?: RuntimeProviderUsage
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
    resource_bindings?: RuntimeResourceBinding[]
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

export interface RuntimeContextBootstrap {
  estimated_tokens: number
  warning: boolean
  provider_usage_supported?: boolean
  context_assessment_supported?: boolean
  request_usage_supported?: boolean
  progress_supported?: boolean
  checkpoint?: RuntimeContextCheckpoint
}

export function isRuntimeBootstrap(value: unknown, start: AgentWorkerStartMessage): value is RuntimeBootstrap {
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
    || !isRuntimeResourceBindings(value.session.resource_bindings)
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
    && (value.provider_usage_supported === undefined || typeof value.provider_usage_supported === 'boolean')
    && (value.request_usage_supported === undefined || typeof value.request_usage_supported === 'boolean')
    && (value.progress_supported === undefined || typeof value.progress_supported === 'boolean')
    && (value.context_assessment_supported === undefined || typeof value.context_assessment_supported === 'boolean')
    && (value.checkpoint === undefined || isRuntimeContextCheckpoint(value.checkpoint))
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
    && (value.provider_usage === undefined || (value.role === 'assistant'
      && isRuntimeProviderUsage(value.provider_usage)
      && value.parts[value.parts.length - 1]?.id === value.provider_usage.last_part_id
      && value.parts[value.parts.length - 1]?.kind !== 'tool_result'))
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
