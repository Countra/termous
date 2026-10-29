import { useMemo } from 'react'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'

export function useAgentLocalDirectory(gateway: AgentWorkspaceGateway, sessionId: string | undefined, ensureSession: () => Promise<string>) {
  return useMemo(() => {
    if (!gateway.localDirectory || !gateway.setLocalDirectory) return {}
    return {
      onReadLocalDirectory: async () => gateway.localDirectory!(sessionId ?? await ensureSession()),
      onChangeLocalDirectory: async (path: string, revision: number) => gateway.setLocalDirectory!(sessionId ?? await ensureSession(), path, revision),
    }
  }, [gateway, sessionId, ensureSession])
}
