export type AgentApprovalMode = 'review' | 'bypass'

export type AgentApprovalPolicyState =
  | { status: 'unavailable' }
  | { status: 'ready'; mode: AgentApprovalMode }

export function agentApprovalModeFromBypass(approvalBypass: boolean): AgentApprovalMode {
  return approvalBypass ? 'bypass' : 'review'
}

export function agentApprovalModeToBypass(mode: AgentApprovalMode): boolean {
  switch (mode) {
    case 'review':
      return false
    case 'bypass':
      return true
    default: {
      const unsupportedMode: never = mode
      throw new Error(`Unsupported Agent approval mode: ${String(unsupportedMode)}`)
    }
  }
}
