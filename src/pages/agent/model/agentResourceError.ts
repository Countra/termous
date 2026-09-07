export type AgentResourceUnavailableReason =
  | 'not_found'
  | 'not_connected'
  | 'not_ready'
  | 'core_restarted'
  | 'identity_changed'
  | 'unknown'

export type AgentResourceError =
  | { kind: 'unavailable'; reason: AgentResourceUnavailableReason }
  | { kind: 'revision_conflict' }
  | { kind: 'run_conflict' }
  | { kind: 'generic' }

const unavailableReasons = new Set<AgentResourceUnavailableReason>([
  'not_found',
  'not_connected',
  'not_ready',
  'core_restarted',
  'identity_changed',
])

export function resolveAgentResourceError(error: unknown): AgentResourceError {
  const code = errorCode(error)
  if (code === 'AGENT_RESOURCE_BINDING_UNAVAILABLE') {
    return { kind: 'unavailable', reason: errorDetailReason(error) }
  }
  if (code === 'AGENT_REVISION_CONFLICT') return { kind: 'revision_conflict' }
  if (code === 'AGENT_RUN_CONFLICT') return { kind: 'run_conflict' }
  return { kind: 'generic' }
}

function errorCode(error: unknown) {
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
  if (typeof code === 'string' && code) return code
  return error instanceof Error && error.message === 'AGENT_RESOURCE_BINDING_UNAVAILABLE'
    ? error.message
    : undefined
}

function errorDetailReason(error: unknown): AgentResourceUnavailableReason {
  const details = error && typeof error === 'object' ? Reflect.get(error, 'details') : undefined
  const reason = details && typeof details === 'object' ? Reflect.get(details, 'reason') : undefined
  return typeof reason === 'string' && unavailableReasons.has(reason as AgentResourceUnavailableReason)
    ? reason as AgentResourceUnavailableReason
    : 'unknown'
}
