import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalRequiredScopes,
  defaultMcpScopes,
  mcpScopes,
} from '#entities/mcp-access'
import { mcpScopeCatalog, mcpScopeGroups } from './mcpScopeCatalog.ts'

test('每个 MCP Scope 恰好归属一个权限组', () => {
  const groupedScopes = mcpScopeGroups.flatMap((group) => group.scopes)
  const counts = new Map(groupedScopes.map((scope) => [
    scope,
    groupedScopes.filter((candidate) => candidate === scope).length,
  ]))

  assert.deepEqual(new Set(groupedScopes), new Set(mcpScopes))
  for (const scope of mcpScopes) assert.equal(counts.get(scope), 1, `${scope} 必须且只能归属一个权限组`)
})

test('Scope 目录统一提供默认、审批和展示元数据', () => {
  assert.deepEqual(mcpScopeCatalog.map((entry) => entry.scope), [...mcpScopes])
  assert.deepEqual(
    mcpScopeCatalog.filter((entry) => entry.defaultEnabled).map((entry) => entry.scope),
    defaultMcpScopes,
  )
  assert.deepEqual(
    mcpScopeCatalog.filter((entry) => entry.requiresApproval).map((entry) => entry.scope),
    approvalRequiredScopes,
  )
  assert.ok(mcpScopeCatalog.every((entry) => entry.labelKey && entry.descriptionKey))
})
