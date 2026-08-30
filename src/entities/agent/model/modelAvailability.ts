import type { AgentModel, AgentModelProvider } from './types.ts'

export function isAgentModelRunnable(
  model: AgentModel,
  provider: AgentModelProvider | undefined,
) {
  return Boolean(provider?.enabled
    && !model.removed_at
    && model.availability === 'available'
    && (model.source === 'manual' || provider.refresh_status === 'ready'))
}
