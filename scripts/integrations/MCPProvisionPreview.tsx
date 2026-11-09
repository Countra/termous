import { useState } from 'react'
import { Button } from 'antd'
import type { AgentIntegrationSource, MCPDependency } from '#entities/agent-integrations'
import { MCPProvisionDialog } from '../../src/features/agent-integrations/ui/MCPProvisionDialog'
import { createIntegrationFixture } from './fixture'

// 配置页验收只读取合成安装记录；不会连接 Core 或执行安装和 MCP 进程。
const params = new URLSearchParams(location.search)
const source: AgentIntegrationSource = {
  id: 'ext_provision_preview', revision: 1, name: 'playwright', kind: 'mcp', enabled: false,
  secret_configured: false, created_at: '', updated_at: '',
  mcp: params.has('http') ? { transport: 'http', url: 'https://mcp.example.test/api/mcp', auth: 'oauth' }
    : { transport: 'stdio', mode: params.has('external') ? 'external' : 'managed_npm', command: 'npx', args: ['@playwright/mcp@latest'] },
}
const state = params.has('installing') ? 'preparing' : params.has('pending') ? 'preview' : 'ready'
const dependency: MCPDependency = {
  id: `prep_${'a'.repeat(32)}`, source_id: source.id, revision: source.revision, state,
  root: 'D:\\Termous\\data\\agent\\integrations\\packages',
  package: { name: '@playwright/mcp', version: '0.0.83', entry: 'cli.js', arguments: [], integrity: 'fixture' },
  runtime: { node: 'node', npm: 'npm', identity: 'fixture' },
}
const gateway = { ...createIntegrationFixture(), dependency: async () => structuredClone(dependency) }

export function MCPProvisionPreview() {
  const [open, setOpen] = useState(true)
  return <><Button onClick={() => setOpen(true)}>MCP</Button>{open && <MCPProvisionDialog sources={[source]} gateway={gateway} onClose={() => setOpen(false)} onChanged={() => {}} />}</>
}
