import type {
  McpApproval,
  McpApprovalDecisionResult,
  McpApprovalEvent,
  McpApprovalKind,
  McpApprovalOperation,
  McpApprovalSnapshot,
  McpApprovalState,
} from '#entities/mcp-access'
import {
  McpAccessProtocolError,
  optionalArray,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalString,
  optionalStringArray,
  requireArray,
  requireBoolean,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
} from './base.ts'

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
const approvalKinds = new Set<McpApprovalKind>([
  'command',
  'sftp',
  'remoteops',
  'forwarding',
  'snippet',
])
const overwritePolicies = new Set<McpApprovalOperation['overwrite_policy']>([
  'rename',
  'skip',
  'overwrite',
])

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
    throw new McpAccessProtocolError(approvalOperationMissingMessage[normalizedKind])
  }
  const sessionBound = normalizedKind === 'command' || normalizedKind === 'remoteops'
  const common = {
    id: requireString(approval.id, 'MCP 审批请求 ID 缺失'),
    revision: requireNonNegativeInteger(approval.revision, 'MCP 审批请求修订号无效'),
    client_id: requireString(approval.client_id, 'MCP 审批客户端 ID 缺失'),
    client_name: requireString(approval.client_name, 'MCP 审批客户端名称缺失'),
    client_request_id: requireString(approval.client_request_id, 'MCP 审批请求标识缺失'),
    session_ids: (sessionBound
      ? requireArray(approval.session_ids, 'MCP 审批会话列表无效')
      : optionalArray(approval.session_ids, 'MCP 审批会话列表无效'))
      .map((sessionId) => requireString(sessionId, 'MCP 审批会话 ID 无效')),
    targets: (sessionBound
      ? requireArray(approval.targets, 'MCP 审批目标列表无效')
      : optionalArray(approval.targets, 'MCP 审批目标列表无效')).map((targetValue) => {
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
  if (normalizedKind === 'forwarding') {
    return {
      ...common,
      kind: 'forwarding',
      command: optionalString(approval.command) ?? '',
      operation: operation!,
    }
  }
  if (normalizedKind === 'snippet') {
    return {
      ...common,
      kind: 'snippet',
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
    lifecycle: optionalString(operation.lifecycle),
    bind_address: optionalString(operation.bind_address),
    target_address: optionalString(operation.target_address),
    group_name: optionalString(operation.group_name),
    shell: optionalString(operation.shell),
    description: optionalString(operation.description),
    tags: optionalStringArray(operation.tags, 'MCP 代码片段审批标签无效'),
    item_count: optionalNonNegativeInteger(operation.item_count, 'MCP SFTP 审批项目数无效'),
    total_bytes: optionalNonNegativeInteger(operation.total_bytes, 'MCP SFTP 审批字节数无效'),
  }
}

const approvalOperationMissingMessage: Record<Exclude<McpApprovalKind, 'command'>, string> = {
  sftp: 'MCP SFTP 审批操作缺失',
  remoteops: 'MCP 远程运维审批操作缺失',
  forwarding: 'MCP 端口转发审批操作缺失',
  snippet: 'MCP 代码片段审批操作缺失',
}
