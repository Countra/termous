import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeArchive, decodeArchivePreview, decodePersonalOperation, decodePersonalSetup, decodePersonalStatus, decodeWorkspaceRestart } from './recovery.ts'

const operation = { id: 'personal_setup_fixture', kind: 'setup', status: 'verified', revision: '2', membership_head: 'synthetic-head', personal_revision: '0', key_epoch: '1', expires_at: '2026-10-01T08:00:00Z', verified_until: '2026-10-01T07:55:00Z' }
const key = `TRK1-${Array(12).fill('ABCDE').join('-')}`
const restart = { id: 'restart_fixture', status: 'pending', revision: 1, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: operation.expires_at, email_sent: false, source_device_count: 4 }

test('恢复合同拒绝非法 ID、版本、期限和未知状态', () => {
  assert.deepEqual(decodePersonalStatus({ enabled: true, revision: '1' }), { enabled: true, revision: '1' })
  assert.deepEqual(decodePersonalOperation(operation), operation)
  for (const patch of [{ id: '' }, { id: '../escape' }, { id: 'a'.repeat(129) }, { revision: '01' }, { revision: '9223372036854775808' }, { key_epoch: '-1' }, { expires_at: 'invalid' }, { verified_until: null }, { kind: 'other' }, { status: 'unknown' }]) {
    assert.throws(() => decodePersonalOperation({ ...operation, ...patch }))
  }
  assert.throws(() => decodePersonalStatus({ enabled: 'true', revision: '0' }))
})

test('短时密钥只从已验证的设置响应交付，普通查询不暴露额外秘密', () => {
  const setup = { ...operation, recovery_key: key, confirm_groups: [0, 11] }
  assert.deepEqual(decodePersonalSetup(setup), setup)
  assert.deepEqual(decodePersonalOperation(setup), operation)
  for (const patch of [{ kind: 'recover' }, { status: 'pending' }, { status: 'completed' }, { recovery_key: key.toLowerCase() }, { confirm_groups: [0, 0] }, { confirm_groups: [-1, 1] }, { confirm_groups: [1, 12] }, { confirm_groups: [0, 1, 2] }]) {
    assert.throws(() => decodePersonalSetup({ ...setup, ...patch }))
  }
})

test('重置和归档拒绝非法水位、计数及路径参数', () => {
  assert.equal(decodeWorkspaceRestart(restart).source_device_count, 4)
  for (const patch of [{ revision: 0 }, { revision: '1' }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { source_device_count: -1 }, { source_device_count: 1.5 }, { target_workspace_id: 'workspace/new' }, { local_pending: 'true' }, { archive_expires_at: 'invalid' }]) {
    assert.throws(() => decodeWorkspaceRestart({ ...restart, ...patch }))
  }
  const archive = { id: 'workspace_old', status: 'archived', revision: '1', expires_at: operation.expires_at, local_key_available: true }
  assert.deepEqual(decodeArchive(archive), archive)
  assert.throws(() => decodeArchive({ ...archive, status: 'deleted' }))
  assert.throws(() => decodeArchive({ ...archive, id: 'https://example.test' }))
  assert.throws(() => decodeArchivePreview({ id: 'preview_fixture', generation: 'fixture', blocked: false, items: [], conflicts: [], workspace_id: 'workspace_old', expires_at: 'invalid' }))
})
