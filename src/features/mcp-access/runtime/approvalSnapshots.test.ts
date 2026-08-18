import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpApproval, McpApprovalSnapshot } from '#entities/mcp-access'
import { mergeApprovalDecision, mergeApprovalSnapshot } from './approvalSnapshots.ts'

test('审批快照忽略同实例旧 revision，并接受新实例的较小 revision', () => {
  const current = snapshotFixture('instance-1', 8, [approvalFixture('approval-1')])

  assert.strictEqual(mergeApprovalSnapshot(current, snapshotFixture('instance-1', 8, [])), current)
  assert.strictEqual(mergeApprovalSnapshot(current, snapshotFixture('instance-1', 7, [])), current)

  const restarted = mergeApprovalSnapshot(current, snapshotFixture('instance-2', 1, []))
  assert.equal(restarted.instance_id, 'instance-2')
  assert.equal(restarted.revision, 1)
})

test('审批快照仅保留 pending 项并按创建时间和 ID 稳定排序', () => {
  const incoming = snapshotFixture('instance-1', 9, [
    approvalFixture('approval-b', '2026-08-13T00:00:02Z'),
    { ...approvalFixture('approval-dispatching'), state: 'dispatching' },
    approvalFixture('approval-c', '2026-08-13T00:00:01Z'),
    approvalFixture('approval-a', '2026-08-13T00:00:02Z'),
  ])

  const merged = mergeApprovalSnapshot(snapshotFixture('', 0, []), incoming)
  assert.deepEqual(merged.items.map((approval) => approval.id), ['approval-c', 'approval-a', 'approval-b'])
})

test('审批决定会更新仍为 pending 的项目，并移除进入终态或调度态的项目', () => {
  const current = snapshotFixture('instance-1', 9, [
    approvalFixture('approval-1'),
    approvalFixture('approval-2'),
  ])
  const updated = { ...approvalFixture('approval-1'), revision: 4, command: 'whoami' }
  const pending = mergeApprovalDecision(current, updated)
  assert.equal(pending.items[0]?.command, 'whoami')
  assert.equal(pending.items[0]?.revision, 4)

  const dispatched = mergeApprovalDecision(pending, { ...updated, state: 'dispatching' })
  assert.deepEqual(dispatched.items.map((approval) => approval.id), ['approval-2'])
})

function snapshotFixture(instanceId: string, revision: number, items: McpApproval[]): McpApprovalSnapshot {
  return { instance_id: instanceId, revision, items }
}

function approvalFixture(id: string, createdAt = '2026-08-13T00:00:00Z'): McpApproval {
  return {
    id,
    revision: 3,
    client_id: 'client-1',
    client_name: 'Codex',
    client_request_id: `request-${id}`,
    kind: 'command',
    command: 'uname -s',
    session_ids: [],
    targets: [],
    state: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: '2026-08-13T00:03:00Z',
  }
}
