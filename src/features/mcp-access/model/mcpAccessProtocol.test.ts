import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeMcpApprovalDecisionResult,
  decodeMcpApprovalEvent,
  decodeMcpApprovalSnapshot,
  decodeMcpClientToken,
  decodeMcpClients,
  decodeMcpStatus,
} from './mcpAccessProtocol.ts'

test('MCP 管理协议解码 canonical 状态、客户端和一次性令牌', () => {
  const status = decodeMcpStatus(statusFixture())
  assert.equal(status.endpoint, 'http://127.0.0.1:18131/mcp')
  assert.equal(status.revision, 4)

  const clients = decodeMcpClients([clientFixture()])
  assert.equal(clients[0]?.host_access_mode, 'all_saved')
  assert.equal(clients[0]?.token_prefix, 'tmcp_abcd')

  const credential = decodeMcpClientToken({ client: clientFixture(), token: 'tmcp_secret' })
  assert.equal(credential.token, 'tmcp_secret')
  assert.equal(credential.client.revision, 7)
})

test('MCP 审批协议使用完整快照事件并保留调度冲突状态', () => {
  const snapshot = decodeMcpApprovalSnapshot(approvalSnapshotFixture('dispatch_conflict'))
  assert.equal(snapshot.items[0]?.state, 'dispatch_conflict')
  assert.equal(snapshot.items[0]?.targets[0]?.host_name, '测试主机')

  const event = decodeMcpApprovalEvent({
    type: 'mcp_approval_update',
    snapshot: approvalSnapshotFixture('pending'),
  })
  assert.equal(event.snapshot.revision, 12)
  assert.equal(event.snapshot.items[0]?.command, 'uname -s')

  const result = decodeMcpApprovalDecisionResult({
    approval: approvalFixture('dispatching'),
    task: { id: 'task-1' },
  })
  assert.equal(result.approval.state, 'dispatching')
})

test('MCP 管理协议拒绝旧别名、未知权限和非 canonical 事件', () => {
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    endpoint: undefined,
    url: 'http://127.0.0.1:18131/mcp',
  }), /连接地址/)
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    protocol_version: '2025-03-26',
  }), /协议版本/)
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    enabled: false,
  }), /不一致/)
  assert.throws(() => decodeMcpClients([{ ...clientFixture(), scopes: ['hosts:admin'] }]), /未知权限/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    approvals: [approvalFixture('pending')],
  }), /审批列表/)
  assert.throws(() => decodeMcpApprovalEvent({
    type: 'snapshot',
    snapshot: approvalSnapshotFixture('pending'),
  }), /事件类型/)
})

function statusFixture() {
  return {
    instance_id: 'instance-1',
    enabled: true,
    revision: 4,
    state: 'enabled',
    endpoint: 'http://127.0.0.1:18131/mcp',
    protocol_version: '2025-11-25',
  }
}

function clientFixture() {
  return {
    id: 'client-1',
    name: 'Codex workspace',
    enabled: true,
    scopes: ['hosts:read', 'sessions:read'],
    host_access_mode: 'all_saved',
    token_prefix: 'tmcp_abcd',
    revision: 7,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:01:00Z',
  }
}

function approvalSnapshotFixture(state: string) {
  return {
    instance_id: 'instance-1',
    revision: 12,
    items: [approvalFixture(state)],
  }
}

function approvalFixture(state: string) {
  return {
    id: 'approval-1',
    revision: 3,
    client_id: 'client-1',
    client_name: 'Codex workspace',
    client_request_id: 'request-1',
    command: 'uname -s',
    session_ids: ['session-1'],
    targets: [{
      id: 'session-1',
      host_id: 'host-1',
      host_name: '测试主机',
      endpoint: '127.0.0.1:22',
      status: 'connected',
      phase: 'ready',
      started_at: '2026-08-13T00:00:00Z',
      connected_at: '2026-08-13T00:00:01Z',
      host_key_confirmation_required: false,
      owned_by_client: false,
    }],
    state,
    created_at: '2026-08-13T00:01:00Z',
    updated_at: '2026-08-13T00:01:01Z',
    expires_at: '2026-08-13T00:03:00Z',
  }
}
