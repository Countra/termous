import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { isRecord } from './protocol.ts'

export interface RuntimeContextImageReference {
  type: 'image_ref'
  mime_type: string
  sha256: string
  attachment_id?: string
  message_part_id?: string
  content_index?: number
}

export interface RuntimeContextCheckpoint {
  id?: string
  version?: 1 | 2
  boundary_message_sequence: number
  summary: string
  estimated_tokens: number
  retained_tail?: AgentMessage[]
  image_sources?: RuntimeContextImageReference[]
  details?: Record<string, unknown>
  run_id?: string
  generation?: number
  covered_event_sequence?: number
}

export interface RuntimeCheckpointInput {
  generation: number
  event_id: string
  sequence: number
  compaction_id: string
  base_checkpoint_id: string
  covered_event_sequence: number
  summary: string
  retained_tail: unknown[]
  details?: Record<string, unknown>
  tokens_before: number
  tokens_after: number
}

export interface RuntimeCheckpointResult {
  checkpoint: RuntimeContextCheckpoint
  last_sequence: number
}

export function isRuntimeContextCheckpoint(value: unknown): value is RuntimeContextCheckpoint {
  if (!isRecord(value)
    || !nonnegativeInteger(value.boundary_message_sequence)
    || !validSummary(value.summary)
    || !nonnegativeInteger(value.estimated_tokens)) return false
  if (value.version === undefined || value.version === 1) {
    return Number(value.boundary_message_sequence) > 0
      && (value.id === undefined || identifier(value.id))
  }
  return value.version === 2
    && identifier(value.id)
    && identifier(value.run_id)
    && positiveInteger(value.generation)
    && nonnegativeInteger(value.covered_event_sequence)
    && Array.isArray(value.retained_tail)
    && (value.details === undefined || (isRecord(value.details)
      && Buffer.byteLength(JSON.stringify(value.details), 'utf8') <= 64 * 1024))
    && value.retained_tail.every(isHydratedContextMessage)
    && Array.isArray(value.image_sources)
    && value.image_sources.every(isRuntimeImageReference)
}

export function isRuntimeCheckpointInput(value: RuntimeCheckpointInput, generation: number) {
  return value.generation === generation
    && identifier(value.event_id)
    && identifier(value.compaction_id)
    && (value.base_checkpoint_id === '' || identifier(value.base_checkpoint_id))
    && positiveInteger(value.sequence)
    && nonnegativeInteger(value.covered_event_sequence)
    && value.covered_event_sequence < value.sequence
    && validSummary(value.summary)
    && Array.isArray(value.retained_tail)
    && (value.details === undefined || (isRecord(value.details)
      && Buffer.byteLength(JSON.stringify(value.details), 'utf8') <= 64 * 1024))
    && nonnegativeInteger(value.tokens_before)
    && nonnegativeInteger(value.tokens_after)
    && value.tokens_after < value.tokens_before
    && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 1024 * 1024
}

export function isRuntimeImageReference(value: unknown): value is RuntimeContextImageReference {
  if (!isRecord(value) || value.type !== 'image_ref'
    || typeof value.mime_type !== 'string' || !value.mime_type.startsWith('image/')
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sha256)) return false
  return identifier(value.attachment_id)
    ? value.message_part_id === undefined && value.content_index === undefined
    : value.attachment_id === undefined && identifier(value.message_part_id)
      && nonnegativeInteger(value.content_index)
}

function isHydratedContextMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || !nonnegativeInteger(value.timestamp)) return false
  if (value.role === 'user') return typeof value.content === 'string' || userContent(value.content)
  if (value.role === 'toolResult') {
    return typeof value.toolCallId === 'string' && typeof value.toolName === 'string'
      && typeof value.isError === 'boolean' && userContent(value.content)
  }
  if (value.role !== 'assistant' || !Array.isArray(value.content)
    || !value.content.every(assistantContent) || typeof value.api !== 'string'
    || typeof value.provider !== 'string' || typeof value.model !== 'string'
    || !['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(value.stopReason))
    || !isRecord(value.usage)) return false
  return ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every((key) => (
    nonnegativeInteger((value.usage as Record<string, unknown>)[key])
  ))
}

function userContent(value: unknown) {
  return Array.isArray(value) && value.every((part) => isRecord(part) && (
    (part.type === 'text' && typeof part.text === 'string')
    || (part.type === 'image' && typeof part.data === 'string'
      && typeof part.mimeType === 'string' && part.mimeType.startsWith('image/'))
  ))
}

function assistantContent(value: unknown) {
  return isRecord(value) && (
    (value.type === 'text' && typeof value.text === 'string')
    || (value.type === 'thinking' && typeof value.thinking === 'string')
    || (value.type === 'toolCall' && typeof value.id === 'string'
      && typeof value.name === 'string' && isRecord(value.arguments))
  )
}

function validSummary(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value
    && Buffer.byteLength(value, 'utf8') <= 256 * 1024
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0
}
