import { createContext, useContext } from 'react'
import type {
  McpApproval,
  McpApprovalDecision,
  McpClient,
  McpClientInput,
  McpClientPatch,
  McpClientToken,
  McpStatus,
} from '#entities/mcp-access'

export type McpAccessRuntimePhase = 'idle' | 'loading' | 'ready' | 'reconciling' | 'degraded'

export interface McpAccessRuntimeValue {
  phase: McpAccessRuntimePhase
  status: McpStatus | null
  clients: McpClient[]
  approvals: McpApproval[]
  mutationKey: string
  errorCode: string
  reload(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  createClient(input: McpClientInput): Promise<McpClientToken>
  patchClient(clientId: string, patch: McpClientPatch): Promise<void>
  revokeClient(clientId: string): Promise<void>
  issueToken(clientId: string): Promise<McpClientToken>
  decideApproval(approvalId: string, decision: McpApprovalDecision): Promise<void>
}

export const McpAccessRuntimeContext = createContext<McpAccessRuntimeValue | null>(null)

export function useMcpAccessRuntime() {
  const runtime = useContext(McpAccessRuntimeContext)
  if (!runtime) throw new Error('useMcpAccessRuntime 必须在 McpAccessRuntimeProvider 内使用')
  return runtime
}
