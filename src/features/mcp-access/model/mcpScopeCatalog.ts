import {
  approvalRequiredScopes,
  defaultMcpScopes,
  mcpScopes,
  type McpScope,
} from '#entities/mcp-access'

export type McpScopeGroupKey =
  | 'hosts'
  | 'sessions'
  | 'commands'
  | 'sftp'
  | 'system'
  | 'processes'
  | 'services'
  | 'docker'
  | 'crontab'

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
  { key: 'hosts', scopes: ['hosts:read', 'hosts:probe'] },
  { key: 'sessions', scopes: ['sessions:read', 'sessions:connect', 'sessions:close'] },
  { key: 'commands', scopes: ['commands:execute', 'commands:read', 'commands:interrupt'] },
  { key: 'sftp', scopes: ['sftp:read', 'sftp:connect', 'sftp:close', 'sftp:write', 'sftp:transfer', 'sftp:cancel'] },
  { key: 'system', scopes: ['system:read'] },
  { key: 'processes', scopes: ['processes:read', 'processes:terminate'] },
  { key: 'services', scopes: ['services:read', 'services:manage'] },
  { key: 'docker', scopes: ['docker:read', 'docker:manage'] },
  { key: 'crontab', scopes: ['crontab:read', 'crontab:write'] },
]

const groupByScope = new Map(
  mcpScopeGroups.flatMap((group) => group.scopes.map((scope) => [scope, group.key] as const)),
)

export const mcpScopeCatalog: readonly McpScopeCatalogEntry[] = mcpScopes.map((scope) => {
  const group = groupByScope.get(scope)
  if (!group) throw new Error(`MCP 权限未归类: ${scope}`)
  const key = scope.replace(':', '_')
  return {
    scope,
    group,
    labelKey: `settings.mcp.scope.${key}`,
    descriptionKey: `settings.mcp.scopeDescription.${key}`,
    defaultEnabled: defaultMcpScopes.includes(scope),
    requiresApproval: approvalRequiredScopes.includes(scope),
    destructive: scope === 'sessions:close',
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
