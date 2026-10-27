import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMcpApprovalDecisionResult, decodeMcpApprovalEvent, decodeMcpApprovalSnapshot } from './approval.ts'
import { McpAccessProtocolError } from './base.ts'

function approvalFixture(kind = 'desktop', operation: Record<string, unknown> = {}) {
  return {
    id: 'desktop-approval', revision: 1, client_id: 'builtin-agent', client_name: 'Termous Agent',
    client_request_id: 'desktop-request', kind, state: 'pending',
    created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', expires_at: '2026-10-27T00:02:00Z',
    operation: {
      domain: kind, action: 'control.acquire', resource_id: 'display-0', resource_name: '本机桌面：显示器 1',
      resource_kind: 'host_desktop', mode: 'observe_to_control', timeout_seconds: 1800, ...operation,
    },
  }
}

test('本机与协议桌面的原始审批在 HTTP、事件和决定回执中使用同一合同', () => {
  for (const resource_kind of ['host_desktop', 'rdp', 'vnc']) {
    const approval = approvalFixture('desktop', { resource_kind })
    const snapshot = { instance_id: 'core-1', revision: 1, items: [approval] }
    assert.equal(decodeMcpApprovalSnapshot(snapshot).items[0]?.operation?.resource_kind, resource_kind)
    assert.equal(decodeMcpApprovalEvent({ type: 'mcp_approval_update', snapshot }).snapshot.items.length, 1)
    for (const state of ['dispatching', 'approved', 'rejected', 'expired', 'cancelled', 'dispatch_conflict']) {
      assert.equal(decodeMcpApprovalDecisionResult({ approval: { ...approval, state } }).approval.state, state)
    }
    assert.deepEqual(decodeMcpApprovalSnapshot(snapshot).items[0]?.session_ids, [])
  }
})

test('本机桌面审批不会阻断同一快照里的其他待审批请求', () => {
  const command = { ...approvalFixture(), id: 'command-approval', kind: 'command', operation: undefined,
    command: 'uname -s', session_ids: [], targets: [] }
  const result = decodeMcpApprovalSnapshot({ instance_id: 'core-1', revision: 2, items: [command, approvalFixture()] })
  assert.deepEqual(result.items.map(item => item.id), ['command-approval', 'desktop-approval'])
})

test('本机桌面仍拒绝未知类型、缺失目标和超出合同的控制范围', () => {
  for (const operation of [
    { resource_kind: 'unknown' }, { resource_kind: 'images' }, { resource_kind: '' },
    { resource_id: '' }, { action: 'input' }, { mode: 'unknown' },
    { timeout_seconds: 3600 }, { timeout_seconds: '1800' },
  ]) {
    assert.throws(() => decodeMcpApprovalSnapshot({ instance_id: 'core-1', revision: 1,
      items: [approvalFixture('desktop', operation)] }), McpAccessProtocolError)
  }
})

test('本机桌面工作流仅接受观察绑定生命周期，协议桌面保留原连接策略', () => {
  const decode = (resource_kind: string, lifecycle: string) => decodeMcpApprovalSnapshot({
    instance_id: 'core-1', revision: 1, items: [approvalFixture('desktop_workflow', {
      action: 'run', script_id: 'script-1', script_version: 2, run_id: 'run-1', resource_kind, lifecycle,
    })],
  }).items[0]!
  assert.equal(decode('host_desktop', 'binding_only').operation?.lifecycle, 'binding_only')
  for (const lifecycle of ['existing_connection', 'keep_connection', 'close_owned']) {
    assert.throws(() => decode('host_desktop', lifecycle), McpAccessProtocolError)
    for (const kind of ['rdp', 'vnc']) assert.equal(decode(kind, lifecycle).operation?.lifecycle, lifecycle)
  }
  for (const kind of ['host_desktop', 'rdp', 'vnc']) {
    assert.throws(() => decode(kind, 'unknown'), McpAccessProtocolError)
    if (kind !== 'host_desktop') assert.throws(() => decode(kind, 'binding_only'), McpAccessProtocolError)
  }
})
