import {
  mcpScopes,
  type McpApproval,
  type McpApprovalDecisionResult,
  type McpApprovalEvent,
  type McpApprovalKind,
  type McpApprovalOperation,
  type McpApprovalSnapshot,
  type McpApprovalState,
  type McpClient,
  type McpClientToken,
  type McpScope,
  type McpServerState,
  type McpStatus,
} from '#entities/mcp-access'

export class McpAccessProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpAccessProtocolError'
  }
}

const serverStates = new Set<McpServerState>(['enabled', 'disabled'])
const scopeValues = new Set<McpScope>(mcpScopes)
const approvalStates = new Set<McpApprovalState>([
  'pending',
  'dispatching',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'dispatch_conflict',
])
const approvalEventTypes = new Set<McpApprovalEvent['type']>([
  'mcp_approval_snapshot',
  'mcp_approval_update',
])
const approvalKinds = new Set<McpApprovalKind>(['command', 'sftp', 'remoteops'])
const overwritePolicies = new Set<McpApprovalOperation['overwrite_policy']>([
  'rename',
  'skip',
  'overwrite',
])

export function decodeMcpStatus(value: unknown): McpStatus {
  const status = requireRecord(value, 'MCP 服务状态缺失')
  const state = requireString(status.state, 'MCP 服务状态无效')
  if (!serverStates.has(state as McpServerState)) {
    throw new McpAccessProtocolError('MCP 服务状态无效')
  }
  const enabled = requireBoolean(status.enabled, 'MCP 启用状态无效')
  if ((state === 'enabled') !== enabled) {
    throw new McpAccessProtocolError('MCP 服务状态与启用状态不一致')
  }
  if (status.protocol_version !== '2025-11-25') {
    throw new McpAccessProtocolError('MCP 协议版本不受支持')
  }
  return {
    instance_id: requireString(status.instance_id, 'MCP 服务实例 ID 缺失'),
    revision: requireNonNegativeInteger(status.revision, 'MCP 服务修订号无效'),
    enabled,
    state: state as McpServerState,
    endpoint: requireString(status.endpoint, 'MCP 连接地址缺失'),
    protocol_version: status.protocol_version,
  }
}

export function decodeMcpClients(value: unknown): McpClient[] {
  return requireArray(value, 'MCP 客户端列表无效').map(decodeMcpClient)
}

export function decodeMcpClient(value: unknown): McpClient {
  const client = requireRecord(value, 'MCP 客户端缺失')
  if (client.host_access_mode !== 'all_saved') {
    throw new McpAccessProtocolError('MCP 客户端主机访问模式无效')
  }
  return {
    id: requireString(client.id, 'MCP 客户端 ID 缺失'),
    name: requireString(client.name, 'MCP 客户端名称缺失'),
    enabled: requireBoolean(client.enabled, 'MCP 客户端启用状态无效'),
    approval_bypass: client.approval_bypass === undefined
      ? false
      : requireBoolean(client.approval_bypass, 'MCP 客户端审批策略无效'),
    scopes: decodeScopes(client.scopes),
    host_access_mode: client.host_access_mode,
    token_prefix: requireString(client.token_prefix, 'MCP 客户端令牌标识缺失'),
    revision: requireNonNegativeInteger(client.revision, 'MCP 客户端修订号无效'),
    created_at: requireString(client.created_at, 'MCP 客户端创建时间缺失'),
    updated_at: requireString(client.updated_at, 'MCP 客户端更新时间缺失'),
    last_used_at: optionalString(client.last_used_at),
  }
}

export function decodeMcpClientToken(value: unknown): McpClientToken {
  const response = requireRecord(value, 'MCP 客户端令牌响应缺失')
  return {
    client: decodeMcpClient(response.client),
    token: requireString(response.token, 'MCP 客户端令牌缺失'),
  }
}

export function decodeMcpApprovalSnapshot(value: unknown): McpApprovalSnapshot {
  const snapshot = requireRecord(value, 'MCP 审批快照缺失')
  return {
    instance_id: requireString(snapshot.instance_id, 'MCP 审批实例 ID 缺失'),
    revision: requireNonNegativeInteger(snapshot.revision, 'MCP 审批快照修订号无效'),
    items: requireArray(snapshot.items, 'MCP 审批列表无效').map(decodeMcpApproval),
  }
}

export function decodeMcpApprovalEvent(value: unknown): McpApprovalEvent {
  const event = requireRecord(value, 'MCP 审批事件缺失')
  const type = requireString(event.type, 'MCP 审批事件类型缺失')
  if (!approvalEventTypes.has(type as McpApprovalEvent['type'])) {
    throw new McpAccessProtocolError('MCP 审批事件类型无效')
  }
  return {
    type: type as McpApprovalEvent['type'],
    snapshot: decodeMcpApprovalSnapshot(event.snapshot),
  }
}

export function decodeMcpApprovalDecisionResult(value: unknown): McpApprovalDecisionResult {
  const result = requireRecord(value, 'MCP 审批结果缺失')
  return { approval: decodeMcpApproval(result.approval) }
}

export function decodeMcpApproval(value: unknown): McpApproval {
  const approval = requireRecord(value, 'MCP 审批请求缺失')
  const state = requireString(approval.state, 'MCP 审批请求状态缺失')
  if (!approvalStates.has(state as McpApprovalState)) {
    throw new McpAccessProtocolError('MCP 审批请求状态无效')
  }
  const kind = optionalString(approval.kind) ?? 'command'
  if (!approvalKinds.has(kind as McpApprovalKind)) {
    throw new McpAccessProtocolError('MCP 审批请求类型无效')
  }
  const normalizedKind = kind as McpApprovalKind
  const operation = approval.operation === undefined
    ? undefined
    : decodeMcpApprovalOperation(approval.operation, normalizedKind)
  if (normalizedKind !== 'command' && !operation) {
    throw new McpAccessProtocolError(
      normalizedKind === 'sftp' ? 'MCP SFTP 审批操作缺失' : 'MCP 远程运维审批操作缺失',
    )
  }
  const common = {
    id: requireString(approval.id, 'MCP 审批请求 ID 缺失'),
    revision: requireNonNegativeInteger(approval.revision, 'MCP 审批请求修订号无效'),
    client_id: requireString(approval.client_id, 'MCP 审批客户端 ID 缺失'),
    client_name: requireString(approval.client_name, 'MCP 审批客户端名称缺失'),
    client_request_id: requireString(approval.client_request_id, 'MCP 审批请求标识缺失'),
    session_ids: (normalizedKind === 'sftp'
      ? optionalArray(approval.session_ids, 'MCP 审批会话列表无效')
      : requireArray(approval.session_ids, 'MCP 审批会话列表无效'))
      .map((sessionId) => requireString(sessionId, 'MCP 审批会话 ID 无效')),
    targets: (normalizedKind === 'sftp'
      ? optionalArray(approval.targets, 'MCP 审批目标列表无效')
      : requireArray(approval.targets, 'MCP 审批目标列表无效')).map((targetValue) => {
      const target = requireRecord(targetValue, 'MCP 审批目标无效')
      return {
        id: requireString(target.id, 'MCP 审批目标 ID 缺失'),
        host_id: requireString(target.host_id, 'MCP 审批目标主机 ID 缺失'),
        host_name: optionalString(target.host_name),
        endpoint: optionalString(target.endpoint),
        status: requireString(target.status, 'MCP 审批目标状态缺失'),
        phase: optionalString(target.phase),
        started_at: requireString(target.started_at, 'MCP 审批目标开始时间缺失'),
        connected_at: optionalString(target.connected_at),
        ended_at: optionalString(target.ended_at),
        host_key_confirmation_required: requireBoolean(
          target.host_key_confirmation_required,
          'MCP 审批目标主机密钥状态无效',
        ),
        owned_by_client: requireBoolean(target.owned_by_client, 'MCP 审批目标归属状态无效'),
      }
    }),
    state: state as McpApprovalState,
    task_id: optionalString(approval.task_id),
    error_code: optionalString(approval.error_code),
    error_message: optionalString(approval.error_message),
    created_at: requireString(approval.created_at, 'MCP 审批请求创建时间缺失'),
    updated_at: requireString(approval.updated_at, 'MCP 审批请求更新时间缺失'),
    expires_at: requireString(approval.expires_at, 'MCP 审批请求过期时间缺失'),
  }
  if (normalizedKind === 'sftp') {
    return {
      ...common,
      kind: 'sftp',
      command: optionalString(approval.command) ?? '',
      operation: operation!,
    }
  }
  if (normalizedKind === 'remoteops') {
    return {
      ...common,
      kind: 'remoteops',
      command: optionalString(approval.command) ?? '',
      operation: operation!,
    }
  }
  return {
    ...common,
    kind: 'command',
    command: requireString(approval.command, 'MCP 审批命令缺失'),
  }
}

function decodeMcpApprovalOperation(value: unknown, kind: McpApprovalKind): McpApprovalOperation {
  const operation = requireRecord(value, 'MCP 审批操作无效')
  const overwritePolicy = optionalString(operation.overwrite_policy)
  if (overwritePolicy && !overwritePolicies.has(overwritePolicy as McpApprovalOperation['overwrite_policy'])) {
    throw new McpAccessProtocolError('MCP SFTP 审批冲突策略无效')
  }
  return {
    action: requireString(operation.action, 'MCP 审批操作类型缺失'),
    domain: kind === 'remoteops'
      ? requireString(operation.domain, 'MCP 远程运维审批领域缺失')
      : optionalString(operation.domain),
    resource_id: optionalString(operation.resource_id),
    resource_name: optionalString(operation.resource_name),
    signal: optionalString(operation.signal),
    timeout_seconds: optionalNonNegativeInteger(operation.timeout_seconds, 'MCP 审批超时时间无效'),
    schedule: optionalString(operation.schedule),
    command: optionalString(operation.command),
    enabled: optionalBoolean(operation.enabled, 'MCP 审批启用状态无效'),
    file_session_id: optionalString(operation.file_session_id),
    target_file_session_id: optionalString(operation.target_file_session_id),
    host_name: optionalString(operation.host_name),
    target_host_name: optionalString(operation.target_host_name),
    remote_paths: optionalStringArray(operation.remote_paths, 'MCP SFTP 审批远程路径无效'),
    remote_target: optionalString(operation.remote_target),
    local_paths: optionalStringArray(operation.local_paths, 'MCP SFTP 审批本机路径无效'),
    local_target: optionalString(operation.local_target),
    overwrite_policy: overwritePolicy as McpApprovalOperation['overwrite_policy'],
    mode: optionalString(operation.mode),
    item_count: optionalNonNegativeInteger(operation.item_count, 'MCP SFTP 审批项目数无效'),
    total_bytes: optionalNonNegativeInteger(operation.total_bytes, 'MCP SFTP 审批字节数无效'),
  }
}

function decodeScopes(value: unknown) {
  const scopes = requireArray(value, 'MCP 客户端权限无效')
  if (!scopes.every((scope) => typeof scope === 'string' && scopeValues.has(scope as McpScope))) {
    throw new McpAccessProtocolError('MCP 客户端包含未知权限')
  }
  return [...new Set(scopes)] as McpScope[]
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireRecord(value: unknown, message: string) {
  const record = optionalRecord(value)
  if (!record) throw new McpAccessProtocolError(message)
  return record
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new McpAccessProtocolError(message)
  return value
}

function optionalArray(value: unknown, message: string): unknown[] {
  return value === undefined || value === null ? [] : requireArray(value, message)
}

function optionalStringArray(value: unknown, message: string) {
  return optionalArray(value, message).map((item) => requireString(item, message))
}

function requireString(value: unknown, message: string) {
  if (typeof value !== 'string' || value.length === 0) throw new McpAccessProtocolError(message)
  return value
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireBoolean(value: unknown, message: string) {
  if (typeof value !== 'boolean') throw new McpAccessProtocolError(message)
  return value
}

function optionalBoolean(value: unknown, message: string) {
  return value === undefined || value === null ? undefined : requireBoolean(value, message)
}

function requireNonNegativeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new McpAccessProtocolError(message)
  return Number(value)
}

function optionalNonNegativeInteger(value: unknown, message: string) {
  return value === undefined || value === null
    ? undefined
    : requireNonNegativeInteger(value, message)
}
