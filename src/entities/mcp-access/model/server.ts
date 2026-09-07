export type McpServerState = 'enabled' | 'disabled'

export interface McpStatus {
  instance_id: string
  revision: number
  enabled: boolean
  state: McpServerState
  endpoint: string
  protocol_version: '2025-11-25'
}

export interface McpSettingsInput {
  enabled: boolean
  expected_revision: number
}
