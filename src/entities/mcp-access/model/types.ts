export const mcpScopes = [
  'hosts:read',
  'hosts:probe',
  'sessions:read',
  'sessions:connect',
  'sessions:close',
  'commands:execute',
  'commands:read',
  'commands:interrupt',
  'sftp:read',
  'sftp:connect',
  'sftp:close',
  'sftp:write',
  'sftp:transfer',
  'sftp:cancel',
  'system:read',
  'processes:read',
  'processes:terminate',
  'services:read',
  'services:manage',
  'docker:read',
  'docker:manage',
  'crontab:read',
  'crontab:write',
] as const

export type McpScope = (typeof mcpScopes)[number]

export const defaultMcpScopes: McpScope[] = ['hosts:read', 'sessions:read']

export const approvalRequiredScopes: readonly McpScope[] = [
  'commands:execute',
  'sftp:write',
  'sftp:transfer',
  'processes:terminate',
  'services:manage',
  'docker:manage',
  'crontab:write',
]

export type McpServerState = 'enabled' | 'disabled'
export type McpApprovalState =
  | 'pending'
  | 'dispatching'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'dispatch_conflict'
export type McpApprovalDecision = 'approve' | 'reject'
export type McpApprovalKind = 'command' | 'sftp' | 'remoteops'

export interface McpApprovalOperation {
  action: string
  domain?: string
  resource_id?: string
  resource_name?: string
  signal?: string
  timeout_seconds?: number
  schedule?: string
  command?: string
  enabled?: boolean
  file_session_id?: string
  target_file_session_id?: string
  host_name?: string
  target_host_name?: string
  remote_paths: string[]
  remote_target?: string
  local_paths: string[]
  local_target?: string
  overwrite_policy?: 'rename' | 'skip' | 'overwrite'
  mode?: string
  item_count?: number
  total_bytes?: number
}

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

export interface McpClient {
  id: string
  name: string
  enabled: boolean
  approval_bypass: boolean
  scopes: McpScope[]
  host_access_mode: 'all_saved'
  token_prefix: string
  revision: number
  created_at: string
  updated_at: string
  last_used_at?: string
}

export interface McpClientInput {
  name: string
  approval_bypass: boolean
  scopes: McpScope[]
}

export interface McpClientPatch {
  name?: string
  enabled?: boolean
  approval_bypass?: boolean
  scopes?: McpScope[]
}

export interface McpClientUpdateInput {
  name: string
  enabled: boolean
  approval_bypass: boolean
  scopes: McpScope[]
  expected_revision: number
}

export interface McpClientToken {
  client: McpClient
  token: string
}

export interface McpApprovalTarget {
  id: string
  host_id: string
  host_name?: string
  endpoint?: string
  status: string
  phase?: string
  started_at: string
  connected_at?: string
  ended_at?: string
  host_key_confirmation_required: boolean
  owned_by_client: boolean
}

interface McpApprovalBase {
  id: string
  revision: number
  client_id: string
  client_name: string
  client_request_id: string
  session_ids: string[]
  targets: McpApprovalTarget[]
  state: McpApprovalState
  task_id?: string
  error_code?: string
  error_message?: string
  created_at: string
  updated_at: string
  expires_at: string
}

export interface McpCommandApproval extends McpApprovalBase {
  kind: 'command'
  command: string
  operation?: never
}

export interface McpSFTPApproval extends McpApprovalBase {
  kind: 'sftp'
  command: string
  operation: McpApprovalOperation
}

export interface McpRemoteOpsApproval extends McpApprovalBase {
  kind: 'remoteops'
  command: string
  operation: McpApprovalOperation
}

export type McpApproval = McpCommandApproval | McpSFTPApproval | McpRemoteOpsApproval

export interface McpApprovalSnapshot {
  instance_id: string
  revision: number
  items: McpApproval[]
}

export interface McpApprovalDecisionResult {
  approval: McpApproval
}

export interface McpApprovalEvent {
  type: 'mcp_approval_snapshot' | 'mcp_approval_update'
  snapshot: McpApprovalSnapshot
}
