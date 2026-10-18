import { useState, type ReactNode } from 'react'
import type { McpClient } from '#entities/mcp-access'
import { McpAccessRuntimeContext } from '../../src/features/mcp-access/runtime/mcpAccessContext'

async function unsupported(): Promise<never> {
  throw new Error('此验收入口不执行令牌、审批或外部资源操作')
}

// 只在预览中提供可交互的内存状态，不连接 MCP 服务或读取真实客户端。
export function PreviewMcpProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true)
  const [clients, setClients] = useState<McpClient[]>([{
    id: 'preview-client', name: 'Codex', source: 'external', read_only: false,
    enabled: true, approval_bypass: false, scopes: ['hosts:read', 'sessions:read', 'files:read'],
    host_access_mode: 'all_saved', token_prefix: 'preview', revision: 1,
    created_at: '2026-10-18T01:00:00Z', updated_at: '2026-10-18T01:00:00Z',
  }])
  return <McpAccessRuntimeContext.Provider value={{
    phase: 'ready', status: { instance_id: 'preview', revision: 1, enabled,
      state: enabled ? 'enabled' : 'disabled', endpoint: 'http://127.0.0.1:49217/mcp', protocol_version: '2025-11-25' },
    clients, approvals: [], mutationKey: '', errorCode: '', reload: async () => undefined,
    setEnabled: async next => setEnabled(next), createClient: unsupported,
    patchClient: async (id, patch) => setClients(current => current.map(client => client.id === id ? { ...client, ...patch } : client)),
    deleteClient: async id => setClients(current => current.filter(client => client.id !== id)),
    issueToken: unsupported, decideApproval: unsupported,
  }}>{children}</McpAccessRuntimeContext.Provider>
}
