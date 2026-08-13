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

export interface McpAccessGateway {
  status(signal?: AbortSignal): Promise<McpStatus>
  updateSettings(input: McpSettingsInput, signal?: AbortSignal): Promise<McpStatus>
  clients(signal?: AbortSignal): Promise<McpClient[]>
  createClient(input: McpClientInput, signal?: AbortSignal): Promise<McpClientToken>
  patchClient(clientId: string, input: McpClientUpdateInput, signal?: AbortSignal): Promise<McpClient>
  deleteClient(clientId: string, expectedRevision: number, signal?: AbortSignal): Promise<McpClient>
  issueClientToken(clientId: string, expectedRevision: number, signal?: AbortSignal): Promise<McpClientToken>
  approvals(signal?: AbortSignal): Promise<McpApprovalSnapshot>
  decideApproval(
    approvalId: string,
    decision: McpApprovalDecision,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<McpApprovalDecisionResult>
  approvalEventsUrl(): string
}
