import type { AgentIntegrationSource, IntegrationToolSummary } from '#common/agent-integrations'
import type { IntegrationRunContext, IntegrationToolDefinition } from './integrations.ts'
import { isRecord } from './validation.ts'

export type IntegrationOperation =
  | { action: 'directory'; fingerprint?:string }
  | { action: 'receipt'; tool_call_id: string }
  | { action: 'resources'; source: string; revision: number; kind: 'resources' | 'templates'; cursor?: string }
  | { action: 'read_resource'; source: string; revision: number; uri: string; tool_call_id: string }
  | { action: 'content'; id: string; offset: number }
  | { action: 'skill'; source: string; version: string; path: string; offset: number; tool_call_id: string }
  | { action: 'definition'; source: string; revision: number; name: string }
  | { action: 'call'; source: string; revision: number; name: string; tool_call_id: string; arguments: Record<string, unknown> }

export interface IntegrationDirectorySource extends Pick<AgentIntegrationSource, 'id' | 'name' | 'kind' | 'revision' | 'skill' | 'skill_selected'> {
  unavailable_reason?: string
  tool_count?: number
}
export interface IntegrationDirectory { status?:string; fingerprint?:string; sources: IntegrationDirectorySource[]; tools: IntegrationToolSummary[] }
export interface IntegrationRuntimePort {
  request(context: IntegrationRunContext, operation: IntegrationOperation, signal?: AbortSignal): Promise<unknown>
  release(run: string): void
}
export interface IntegrationWorkerRequest {
  type: 'integration_request'
  request_id: string
  bearer: string
  operation: IntegrationOperation
}
export type IntegrationWorkerResponse = { type: 'integration_response'; request_id: string; value?: unknown; error?: string }
export type IntegrationDefinition = IntegrationToolDefinition

export function isIntegrationOperation(value: unknown): value is IntegrationOperation {
  if (!isRecord(value)) return false
  if (value.action === 'directory') return value.fingerprint===undefined || typeof value.fingerprint==='string' && /^[a-f0-9]{64}$/u.test(value.fingerprint)
  if (value.action === 'receipt') return typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0 && value.tool_call_id.length <= 256
  if (value.action === 'content') return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0
  if (value.action === 'skill') return typeof value.source === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value.source)
    && typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0 && value.tool_call_id.length <= 256
    && typeof value.version === 'string' && /^[a-f0-9]{64}$/u.test(value.version) && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 512
    && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0
  if (!['definition', 'call', 'resources', 'read_resource'].includes(String(value.action)) || typeof value.source !== 'string'
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value.source) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
  ) return false
  if (value.action === 'resources') return ['resources','templates'].includes(String(value.kind)) && (value.cursor === undefined || typeof value.cursor === 'string' && value.cursor.length <= 8192)
  if (value.action === 'read_resource') return typeof value.uri === 'string' && value.uri.length > 0 && value.uri.length <= 8192 && typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0 && value.tool_call_id.length <= 256
  if (typeof value.name !== 'string' || !value.name.length || value.name.length > 256) return false
  return value.action === 'definition' || typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0 && value.tool_call_id.length <= 256 && isRecord(value.arguments)
}

export function integrationErrorCode(error: unknown) {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.message) ? error.message : 'INTEGRATION_REQUEST_FAILED'
}
