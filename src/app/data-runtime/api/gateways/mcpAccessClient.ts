import type { AppConfig } from '#common/contracts'
import type {
  McpApprovalDecision,
  McpClientInput,
  McpClientUpdateInput,
  McpSettingsInput,
} from '#entities/mcp-access'
import {
  decodeMcpApprovalDecisionResult,
  decodeMcpApprovalSnapshot,
  decodeMcpClient,
  decodeMcpClients,
  decodeMcpClientToken,
  decodeMcpStatus,
} from '#features/mcp-access'
import { TermousApiTransport } from '#shared/api'

const mcpPath = '/api/v1/mcp'

export class McpAccessClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  status(signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/status`, { signal }).then(decodeMcpStatus)
  }

  updateSettings(input: McpSettingsInput, signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/settings`, {
      method: 'PUT',
      body: input,
      signal,
    }).then(decodeMcpStatus)
  }

  clients(signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/clients`, { signal }).then(decodeMcpClients)
  }

  createClient(input: McpClientInput, signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/clients`, {
      method: 'POST',
      body: input,
      signal,
    }).then(decodeMcpClientToken)
  }

  patchClient(clientId: string, input: McpClientUpdateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/clients/${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      body: input,
      signal,
    }).then(decodeMcpClient)
  }

  deleteClient(clientId: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${mcpPath}/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      body: { expected_revision: expectedRevision },
      signal,
    })
  }

  issueClientToken(clientId: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/clients/${encodeURIComponent(clientId)}/token`, {
      method: 'POST',
      body: { expected_revision: expectedRevision },
      signal,
    }).then(decodeMcpClientToken)
  }

  approvals(signal?: AbortSignal) {
    return this.request<unknown>(`${mcpPath}/approvals`, { signal })
      .then(decodeMcpApprovalSnapshot)
  }

  decideApproval(
    approvalId: string,
    decision: McpApprovalDecision,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return this.request<unknown>(
      `${mcpPath}/approvals/${encodeURIComponent(approvalId)}/decisions`,
      {
        method: 'POST',
        body: { decision, expected_revision: expectedRevision },
        signal,
      },
    ).then(decodeMcpApprovalDecisionResult)
  }

  approvalEventsUrl() {
    return this.websocketUrl(`${mcpPath}/approvals/events`)
  }
}
