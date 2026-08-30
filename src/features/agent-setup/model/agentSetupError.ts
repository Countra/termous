export type AgentSetupErrorKey =
  | 'settings.agent.error.conflict'
  | 'settings.agent.error.generic'
  | 'settings.agent.error.modelCapabilityConflict'
  | 'settings.agent.error.modelIdConflict'
  | 'settings.agent.error.modelInUse'
  | 'settings.agent.error.modelUnavailable'
  | 'settings.agent.error.providerInUse'
  | 'settings.agent.error.providerLimit'
  | 'settings.agent.error.providerNameConflict'
  | 'settings.agent.error.providerNotFound'
  | 'settings.agent.error.vaultLocked'

const errorKeys: Readonly<Record<string, AgentSetupErrorKey>> = {
  AGENT_MODEL_CAPABILITY_CONFLICT: 'settings.agent.error.modelCapabilityConflict',
  AGENT_MODEL_ID_CONFLICT: 'settings.agent.error.modelIdConflict',
  AGENT_MODEL_IN_USE: 'settings.agent.error.modelInUse',
  AGENT_MODEL_PROVIDER_IN_USE: 'settings.agent.error.providerInUse',
  AGENT_MODEL_PROVIDER_LIMIT: 'settings.agent.error.providerLimit',
  AGENT_MODEL_PROVIDER_NAME_CONFLICT: 'settings.agent.error.providerNameConflict',
  AGENT_MODEL_PROVIDER_NOT_FOUND: 'settings.agent.error.providerNotFound',
  AGENT_MODEL_UNAVAILABLE: 'settings.agent.error.modelUnavailable',
  AGENT_REVISION_CONFLICT: 'settings.agent.error.conflict',
  VAULT_LOCKED: 'settings.agent.error.vaultLocked',
}

export function agentSetupErrorKey(error: unknown): AgentSetupErrorKey {
  const code = errorCode(error)
  return code ? errorKeys[code] ?? 'settings.agent.error.generic' : 'settings.agent.error.generic'
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
