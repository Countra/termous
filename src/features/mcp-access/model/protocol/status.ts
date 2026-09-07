import type { McpServerState, McpStatus } from '#entities/mcp-access'
import {
  McpAccessProtocolError,
  requireBoolean,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
} from './base.ts'

const serverStates = new Set<McpServerState>(['enabled', 'disabled'])

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
