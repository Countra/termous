import {
  agentResourceConnectionStatuses,
  getAgentResourceBindingBySlot,
  type AgentResourceConnectionOperation,
  type AgentResourceConnectionView,
} from '#entities/agent'
import { AgentRuntimeProtocolError, decodeAgentResourceBinding, decodeAgentSession } from './agentRuntimeProtocol.ts'

export function decodeAgentResourceConnectionView(value: unknown, sessionId: string): AgentResourceConnectionView {
  const source = record(value)
  const instanceId = text(source.instance_id)
  if (source.operation === undefined) invalid()
  return {
    instance_id: instanceId,
    operation: source.operation === null ? null : decodeOperation(source.operation, sessionId, instanceId),
  }
}

function decodeOperation(value: unknown, sessionId: string, instanceId: string): AgentResourceConnectionOperation {
  const source = record(value)
  if (source.kind !== 'ssh_session' || source.session_id !== sessionId || source.instance_id !== instanceId
    || typeof source.retryable !== 'boolean' || !Number.isSafeInteger(source.revision) || Number(source.revision) < 1
    || !agentResourceConnectionStatuses.includes(source.status as never)) invalid()

  const targetSource = record(source.target)
  if (targetSource.platform !== 'linux') invalid()
  const target = {
    host_id: text(targetSource.host_id),
    host_name: text(targetSource.host_name, 1024),
    ssh_profile_id: text(targetSource.ssh_profile_id),
    profile_name: text(targetSource.profile_name, 1024),
    platform: 'linux' as const,
  }
  const binding = source.source_binding === null ? null : decodeAgentResourceBinding(source.source_binding)
  if (binding?.kind === 'file_profile') invalid()
  const result = source.result_session === undefined ? undefined : decodeAgentSession(source.result_session)
  if (Boolean(result) !== (source.status === 'succeeded') || result && result.id !== sessionId) invalid()
  const resultBinding = getAgentResourceBindingBySlot(result?.resource_bindings, 'ssh')
  if (result && (resultBinding?.kind !== 'ssh_session'
    || resultBinding.host_id !== target.host_id
    || resultBinding.ssh_profile_id !== target.ssh_profile_id)) invalid()
  const createdAt = timestamp(source.created_at)
  const updatedAt = timestamp(source.updated_at)

  return {
    id: text(source.id),
    instance_id: instanceId,
    session_id: sessionId,
    kind: 'ssh_session',
    client_request_id: text(source.client_request_id),
    revision: Number(source.revision),
    status: source.status as AgentResourceConnectionOperation['status'],
    target,
    source_binding: binding,
    retryable: source.retryable as boolean,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(source.phase === undefined ? {} : { phase: text(source.phase) }),
    ...(source.message === undefined ? {} : { message: text(source.message, 4096) }),
    ...(source.candidate_session_id === undefined ? {} : { candidate_session_id: text(source.candidate_session_id) }),
    ...(source.error_code === undefined ? {} : { error_code: text(source.error_code) }),
    ...(result ? { result_session: result } : {}),
  }
}

function invalid(): never {
  throw new AgentRuntimeProtocolError('Agent Profile 连接响应无效')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function text(value: unknown, limit = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')
    || new TextEncoder().encode(value).byteLength > limit) invalid()
  return value
}

function timestamp(value: unknown): string {
  const result = text(value, 64)
  if (!Number.isFinite(Date.parse(result))) invalid()
  return result
}
