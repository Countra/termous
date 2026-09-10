import {
  agentResourceRecoveryBlockedReasons, agentResourceRecoveryStatuses,
  type AgentResourceRecoveryOperation, type AgentResourceRecoveryView,
} from '#entities/agent'
import { AgentRuntimeProtocolError, decodeAgentResourceBinding, decodeAgentSession } from './agentRuntimeProtocol.ts'

export function decodeAgentResourceRecoveryView(value: unknown, sessionId: string): AgentResourceRecoveryView {
  const source = record(value)
  const instance = text(source.instance_id)
  if (source.kind !== 'ssh_session' || typeof source.can_recover !== 'boolean') invalid()
  if (source.blocked_reason !== undefined && !agentResourceRecoveryBlockedReasons.includes(source.blocked_reason as never)) invalid()
  const operation = source.operation === null ? null : decodeOperation(source.operation, sessionId, instance)
  return {
    instance_id: instance, kind: 'ssh_session', can_recover: source.can_recover as boolean,
    ...(source.blocked_reason === undefined ? {} : { blocked_reason: source.blocked_reason as AgentResourceRecoveryView['blocked_reason'] }),
    operation,
  }
}

function decodeOperation(value: unknown, sessionId: string, instanceId: string): AgentResourceRecoveryOperation {
  const source = record(value)
  if (source.kind !== 'ssh_session' || source.session_id !== sessionId || source.instance_id !== instanceId
    || typeof source.retryable !== 'boolean' || !Number.isSafeInteger(source.revision) || Number(source.revision) < 1
    || !agentResourceRecoveryStatuses.includes(source.status as never)) invalid()
  const binding = decodeAgentResourceBinding(source.source_binding)
  if (binding.kind !== 'ssh_session') invalid()
  const result = source.result_session === undefined ? undefined : decodeAgentSession(source.result_session)
  if (result && (result.id !== sessionId || source.status !== 'succeeded')) invalid()
  const createdAt = text(source.created_at, 64)
  const updatedAt = text(source.updated_at, 64)
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) invalid()
  return {
    id: text(source.id), instance_id: instanceId, session_id: sessionId, kind: 'ssh_session',
    client_request_id: text(source.client_request_id), revision: Number(source.revision),
    status: source.status as AgentResourceRecoveryOperation['status'], source_binding: binding,
    retryable: source.retryable as boolean, created_at: createdAt, updated_at: updatedAt,
    ...(source.phase === undefined ? {} : { phase: text(source.phase) }),
    ...(source.message === undefined ? {} : { message: text(source.message, 4096) }),
    ...(source.candidate_session_id === undefined ? {} : { candidate_session_id: text(source.candidate_session_id) }),
    ...(source.error_code === undefined ? {} : { error_code: text(source.error_code) }),
    ...(result ? { result_session: result } : {}),
  }
}

function invalid(): never { throw new AgentRuntimeProtocolError('Agent 连接恢复响应无效') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, limit = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || new TextEncoder().encode(value).byteLength > limit) invalid()
  return value
}
