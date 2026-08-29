import {
  mcpScopes,
  type McpClient,
  type McpClientSource,
  type McpClientToken,
  type McpScope,
} from '#entities/mcp-access'
import {
  McpAccessProtocolError,
  optionalString,
  requireArray,
  requireBoolean,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
} from './base.ts'

const scopeValues = new Set<McpScope>(mcpScopes)

export function decodeMcpClients(value: unknown): McpClient[] {
  return requireArray(value, 'MCP 客户端列表无效').map(decodeMcpClient)
}

export function decodeMcpClient(value: unknown): McpClient {
  const client = requireRecord(value, 'MCP 客户端缺失')
  if (client.host_access_mode !== 'all_saved') {
    throw new McpAccessProtocolError('MCP 客户端主机访问模式无效')
  }
  const { source, readOnly } = decodeClientOwnership(client)
  return {
    id: requireString(client.id, 'MCP 客户端 ID 缺失'),
    name: requireString(client.name, 'MCP 客户端名称缺失'),
    source,
    read_only: readOnly,
    enabled: requireBoolean(client.enabled, 'MCP 客户端启用状态无效'),
    approval_bypass: client.approval_bypass === undefined
      ? false
      : requireBoolean(client.approval_bypass, 'MCP 客户端审批策略无效'),
    scopes: decodeScopes(client.scopes),
    host_access_mode: client.host_access_mode,
    token_prefix: decodeTokenPrefix(client.token_prefix, source),
    revision: requireNonNegativeInteger(client.revision, 'MCP 客户端修订号无效'),
    created_at: requireString(client.created_at, 'MCP 客户端创建时间缺失'),
    updated_at: requireString(client.updated_at, 'MCP 客户端更新时间缺失'),
    last_used_at: optionalString(client.last_used_at),
  }
}

function decodeClientOwnership(client: Record<string, unknown>): {
  source: McpClientSource
  readOnly: boolean
} {
  if (client.source === undefined && client.read_only === undefined) {
    return { source: 'external', readOnly: false }
  }
  if (client.source !== 'external' && client.source !== 'builtin_agent') {
    throw new McpAccessProtocolError('MCP 客户端来源无效')
  }
  if (client.source === 'external' && client.read_only === undefined) {
    return { source: client.source, readOnly: false }
  }
  const readOnly = requireBoolean(client.read_only, 'MCP 客户端只读状态无效')
  if ((client.source === 'builtin_agent') !== readOnly) {
    throw new McpAccessProtocolError('MCP 客户端来源与只读状态不一致')
  }
  return { source: client.source, readOnly }
}

function decodeTokenPrefix(value: unknown, source: McpClientSource) {
  if (typeof value !== 'string') {
    throw new McpAccessProtocolError('MCP 客户端令牌标识缺失')
  }
  if (source === 'builtin_agent') {
    if (value !== '') throw new McpAccessProtocolError('Agent 托管客户端令牌投影无效')
    return value
  }
  if (value.length === 0) throw new McpAccessProtocolError('MCP 客户端令牌标识缺失')
  return value
}

export function decodeMcpClientToken(value: unknown): McpClientToken {
  const response = requireRecord(value, 'MCP 客户端令牌响应缺失')
  return {
    client: decodeMcpClient(response.client),
    token: requireString(response.token, 'MCP 客户端令牌缺失'),
  }
}

function decodeScopes(value: unknown) {
  const scopes = requireArray(value, 'MCP 客户端权限无效')
  if (!scopes.every((scope) => typeof scope === 'string' && scopeValues.has(scope as McpScope))) {
    throw new McpAccessProtocolError('MCP 客户端包含未知权限')
  }
  return [...new Set(scopes)] as McpScope[]
}
