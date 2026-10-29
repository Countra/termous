import { useMemo } from 'react'
import type { AgentIntegrationsGateway, IntegrationPolicy } from '#entities/agent-integrations'

export function useAgentIntegrationActions(gateway: AgentIntegrationsGateway | undefined, sessionID: string | undefined, ensureSession:()=>Promise<string>) {
  return useMemo(() => {
    if (!gateway) return {}
    return {
      onReadIntegrations: async () => {
        const [sources,policies]=await Promise.all([gateway.sources(),sessionID ? gateway.policies(sessionID) : Promise.resolve([])])
        return {sources:sources.map(source => ({id:source.id,name:source.name,kind:source.kind,enabled:source.enabled,
          version:source.skill?.version,description:source.skill?.description,allow_implicit:source.skill?.allow_implicit})),policies}
      },
      onChangeIntegration: async (policy:IntegrationPolicy) => gateway.setPolicy(sessionID ?? await ensureSession(),policy),
    }
  },[gateway,sessionID,ensureSession])
}
