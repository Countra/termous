import {
  approvalRequiredScopes,
  defaultMcpScopes,
  mcpScopes,
  type McpScope,
} from '#entities/mcp-access'

export type McpScopeGroupKey =
  | 'host_desktop'
  | 'screen_analyses'
  | 'desktops'
  | 'desktop_workflows'
  | 'hosts'
  | 'sessions'
  | 'commands'
  | 'files'
  | 'system'
  | 'processes'
  | 'services'
  | 'docker'
  | 'crontab'
  | 'forwarding'
  | 'snippets'

export interface McpScopeGroup {
  key: McpScopeGroupKey
  scopes: readonly McpScope[]
}

export interface McpScopeCatalogEntry {
  scope: McpScope
  group: McpScopeGroupKey
  labelKey: string
  descriptionKey: string
  defaultEnabled: boolean
  requiresApproval: boolean
  destructive: boolean
}

export const mcpScopeGroups: readonly McpScopeGroup[] = [
  { key: 'host_desktop', scopes: ['host-desktop:read', 'host-desktop:capture', 'host-desktop:control', 'host-desktop:secure-capture', 'host-desktop:secure-control'] },
  { key: 'screen_analyses', scopes: ['screen_analyses:read', 'screen_analyses:create', 'screen_analyses:delete'] },
  { key: 'hosts', scopes: ['hosts:read', 'hosts:probe'] },
  { key: 'sessions', scopes: ['sessions:read', 'sessions:connect', 'sessions:close'] },
  { key: 'commands', scopes: ['commands:execute', 'commands:read', 'commands:interrupt'] },
  {
    key: 'files',
    scopes: [
      'files:read',
      'files:connect',
      'files:close',
      'files:write',
      'files:delete',
      'files:batch_rename',
      'files:search',
      'files:transfer',
      'files:cancel',
    ],
  },
  { key: 'desktops', scopes: ['desktops:read', 'desktops:connect', 'desktops:capture', 'desktops:control', 'desktops:close'] },
  { key: 'desktop_workflows', scopes: ['desktop_workflows:read', 'desktop_workflows:exchange', 'desktop_workflows:write', 'desktop_workflows:run', 'desktop_workflows:delete'] },
  { key: 'system', scopes: ['system:read'] },
  { key: 'processes', scopes: ['processes:read', 'processes:terminate'] },
  { key: 'services', scopes: ['services:read', 'services:manage'] },
  {
    key: 'docker',
    scopes: [
      'docker:read', 'docker:manage',
      'docker:images:read', 'docker:images:manage',
      'docker:volumes:read', 'docker:volumes:manage',
      'docker:networks:read', 'docker:networks:manage',
    ],
  },
  { key: 'crontab', scopes: ['crontab:read', 'crontab:write'] },
  { key: 'forwarding', scopes: ['forwarding:read', 'forwarding:manage'] },
  { key: 'snippets', scopes: ['snippets:read', 'snippets:write'] },
]

const groupByScope = new Map(
  mcpScopeGroups.flatMap((group) => group.scopes.map((scope) => [scope, group.key] as const)),
)

export const mcpScopeCatalog: readonly McpScopeCatalogEntry[] = mcpScopes.map((scope) => {
  const group = groupByScope.get(scope)
  if (!group) throw new Error(`MCP 权限未归类: ${scope}`)
  const key = scope.replace(/:/g, '_')
  return {
    scope,
    group,
    labelKey: `settings.mcp.scope.${key}`,
    descriptionKey: `settings.mcp.scopeDescription.${key}`,
    defaultEnabled: defaultMcpScopes.includes(scope),
    requiresApproval: approvalRequiredScopes.includes(scope),
    destructive: scope === 'host-desktop:control' || scope === 'host-desktop:secure-control' || scope === 'sessions:close' || scope === 'files:delete' || scope === 'desktops:close' || scope === 'desktops:control'
      || scope === 'desktop_workflows:run' || scope === 'desktop_workflows:delete' || scope === 'screen_analyses:delete'
      || scope === 'docker:images:manage' || scope === 'docker:volumes:manage' || scope === 'docker:networks:manage',
  }
})

const catalogByScope = new Map(mcpScopeCatalog.map((entry) => [entry.scope, entry]))

export function getMcpScopeCatalogEntry(scope: McpScope) {
  const entry = catalogByScope.get(scope)
  if (!entry) throw new Error(`MCP 权限未登记: ${scope}`)
  return entry
}

export function normalizeMcpScopes(scopes: Iterable<McpScope>) {
  const selected = new Set(scopes)
  return mcpScopes.filter((scope) => selected.has(scope))
}

// 只在用户修改选择时补齐依赖，读取旧配置不能自动授予安全权限。
export function toggleMcpScopes(scopes: Iterable<McpScope>, changes: readonly McpScope[], checked: boolean) {
  const next = new Set(scopes)
  for (const scope of changes) {
    if (checked) next.add(scope)
    else next.delete(scope)
  }
  if (checked) {
    if (next.has('host-desktop:secure-control')) {
      next.add('host-desktop:secure-capture')
      next.add('host-desktop:control')
    }
    if (next.has('host-desktop:control') || next.has('host-desktop:secure-capture')) next.add('host-desktop:capture')
  } else {
    if (!next.has('host-desktop:capture')) {
      next.delete('host-desktop:control')
      next.delete('host-desktop:secure-capture')
    }
    if (!next.has('host-desktop:control') || !next.has('host-desktop:secure-capture')) next.delete('host-desktop:secure-control')
  }
  return normalizeMcpScopes(next)
}
