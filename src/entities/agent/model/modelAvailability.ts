import type { AgentModel, AgentModelProvider } from './types.ts'

export function isAgentModelRunnable(
  model: AgentModel,
  provider: AgentModelProvider | undefined,
) {
  return Boolean(provider?.enabled
    && provider.refresh_status === 'ready'
    && model.availability === 'available')
}
