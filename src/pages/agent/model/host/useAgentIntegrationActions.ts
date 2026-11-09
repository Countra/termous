import { useMemo } from 'react'
import type { AgentIntegrationsGateway, IntegrationPolicy } from '#entities/agent-integrations'
import { getTermousBridge } from '#shared/bridge'

export function useAgentIntegrationActions(gateway: AgentIntegrationsGateway | undefined, sessionID: string | undefined, ensureSession:()=>Promise<string>) {
  return useMemo(() => {
    if (!gateway) return {}
    return {
      onReadIntegrations: async () => {
        const [sources,policies,status]=await Promise.all([gateway.sources(),sessionID ? gateway.policies(sessionID) : Promise.resolve([]),
          getTermousBridge()?.agentIntegrations?.status() ?? Promise.resolve([])])
        return {sources:sources.map(source => ({id:source.id,name:source.name,kind:source.kind,enabled:source.enabled,
          connection: status.filter(value => value.source === source.id && value.revision === source.revision && value.session_id === sessionID)
            .sort((a, b) => (b.status_revision ?? 0) - (a.status_revision ?? 0))[0]?.state,
          version:source.skill?.version,description:source.skill?.description,allow_implicit:source.skill?.allow_implicit})),policies}
      },
      onChangeIntegration: async (policy:IntegrationPolicy) => gateway.setPolicy(sessionID ?? await ensureSession(),policy),
    }
  },[gateway,sessionID,ensureSession])
}
