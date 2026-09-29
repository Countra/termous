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

test('Docker 资源权限独立、默认关闭，管理权限要求审批', () => {
  const group = mcpScopeGroups.find((entry) => entry.key === 'docker')
  for (const kind of ['images', 'volumes', 'networks']) {
    for (const action of ['read', 'manage']) {
      const entry = mcpScopeCatalog.find((item) => item.scope === `docker:${kind}:${action}`)
      assert.ok(entry)
      assert.ok(group?.scopes.includes(entry.scope))
      assert.equal(entry.defaultEnabled, false)
      assert.equal(entry.requiresApproval, action === 'manage')
      assert.equal(entry.destructive, action === 'manage')
      assert.equal(entry.labelKey, `settings.mcp.scope.docker_${kind}_${action}`)
    }
  }
})

test('文件管理删除独立授权、默认关闭并要求高风险审批', () => {
  const deletion = mcpScopeCatalog.find((entry) => entry.scope === 'files:delete')
  assert.ok(deletion)
  assert.equal(deletion.defaultEnabled, false)
  assert.equal(deletion.requiresApproval, true)
  assert.equal(deletion.destructive, true)
})
