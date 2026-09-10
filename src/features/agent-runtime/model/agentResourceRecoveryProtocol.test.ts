import assert from 'node:assert/strict'
import test from 'node:test'
import { agentResourceRecoveryBlockedReasons } from '#entities/agent'
import { decodeAgentResourceRecoveryView } from './agentResourceRecoveryProtocol.ts'
import { agentSessionFixture } from './agentRuntimeTestFixtures.ts'

const time = '2026-09-10T00:00:00Z'
const binding = { kind: 'ssh_session', session_id: 'ssh-old', host_id: 'host', ssh_profile_id: 'profile', host_name: '主机', platform: 'linux', bound_at: time }
const operation = {
  id: 'recovery', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
  revision: 1, status: 'connecting', source_binding: binding, retryable: true, created_at: time, updated_at: time,
}
const view = { instance_id: 'core', kind: 'ssh_session', can_recover: false, blocked_reason: 'recovering', operation }

test('恢复协议保留公开 SSH 身份和成功会话，支持空操作及稳定禁用原因', () => {
  assert.deepEqual(decodeAgentResourceRecoveryView(view, 'agent'), view)
  for (const blocked_reason of agentResourceRecoveryBlockedReasons) {
    assert.equal(decodeAgentResourceRecoveryView({ ...view, blocked_reason, operation: null }, 'agent').blocked_reason, blocked_reason)
  }
  const result_session = agentSessionFixture({ id: 'agent' })
  assert.equal(decodeAgentResourceRecoveryView({ ...view, operation: { ...operation, status: 'succeeded', result_session } }, 'agent').operation?.result_session?.id, 'agent')
})

test('恢复协议拒绝跨会话、跨实例、文件引用、未知状态和错误成功结果', () => {
  for (const patch of [
    { session_id: 'other' }, { instance_id: 'other' }, { kind: 'file_profile' }, { status: 'unknown' },
    { source_binding: { ...binding, kind: 'file_profile' } }, { revision: 0 }, { retryable: 'yes' },
    { created_at: 'yesterday' }, { result_session: agentSessionFixture({ id: 'agent' }) },
    { status: 'succeeded', result_session: agentSessionFixture({ id: 'other' }) },
  ]) assert.throws(() => decodeAgentResourceRecoveryView({ ...view, operation: { ...operation, ...patch } }, 'agent'))
  for (const patch of [{ kind: 'file_profile' }, { blocked_reason: 'unrecognized' }, { operation: undefined }, { can_recover: 1 }]) {
    assert.throws(() => decodeAgentResourceRecoveryView({ ...view, ...patch }, 'agent'))
  }
})
