import type {
  McpApprovalDecision,
  McpApprovalDecisionResult,
  McpApprovalSnapshot,
  McpClient,
  McpClientInput,
  McpClientToken,
  McpClientUpdateInput,
  McpSettingsInput,
  McpStatus,
} from '#entities/mcp-access'

export interface McpServerGateway {
  status(signal?: AbortSignal): Promise<McpStatus>
  updateSettings(input: McpSettingsInput, signal?: AbortSignal): Promise<McpStatus>
}

export interface McpClientGateway {
  clients(signal?: AbortSignal): Promise<McpClient[]>
  createClient(input: McpClientInput, signal?: AbortSignal): Promise<McpClientToken>
  patchClient(clientId: string, input: McpClientUpdateInput, signal?: AbortSignal): Promise<McpClient>
  deleteClient(clientId: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  issueClientToken(clientId: string, expectedRevision: number, signal?: AbortSignal): Promise<McpClientToken>
}

export interface McpApprovalGateway {
  approvals(signal?: AbortSignal): Promise<McpApprovalSnapshot>
  decideApproval(
    approvalId: string,
    decision: McpApprovalDecision,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<McpApprovalDecisionResult>
  approvalEventsUrl(): string
}

export interface McpAccessGateway extends McpServerGateway, McpClientGateway, McpApprovalGateway {}
