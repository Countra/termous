import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSSHProfileResourceBinding, AgentSSHResourceBinding } from '#entities/agent'
import { decodeAgentResourceConnectionView } from './agentResourceConnectionProtocol.ts'
import { agentSessionFixture } from './agentRuntimeTestFixtures.ts'

const time = '2026-09-12T00:00:00Z'
const binding: AgentSSHResourceBinding = {
  kind: 'ssh_session', session_id: 'ssh-old', host_id: 'host-old', ssh_profile_id: 'profile-old',
  host_name: '旧主机', platform: 'linux', bound_at: time,
}
const target = {
  host_id: 'host-new', host_name: '新主机', ssh_profile_id: 'profile-new', profile_name: '默认', platform: 'linux',
}
const resultBinding: AgentSSHResourceBinding = {
  ...binding,
  session_id: 'ssh-new',
  host_id: target.host_id,
  host_name: target.host_name,
  ssh_profile_id: target.ssh_profile_id,
}
const operation = {
  id: 'connection', instance_id: 'core', session_id: 'agent', kind: 'ssh_session', client_request_id: 'request',
  revision: 1, status: 'connecting', target, source_binding: binding, retryable: true,
  created_at: time, updated_at: time,
}

const profileBinding: AgentSSHProfileResourceBinding = {
  kind: 'ssh_profile', ssh_profile_id: 'profile-old', ssh_profile_name: '旧配置', host_id: 'host-old',
  host_name: '旧主机', platform: 'linux', bound_at: time,
}

test('Profile 连接协议接受空操作、公开目标、可空源引用和成功会话', () => {
  assert.deepEqual(decodeAgentResourceConnectionView({ instance_id: 'core', operation: null }, 'agent'), {
    instance_id: 'core', operation: null,
  })
  assert.deepEqual(decodeAgentResourceConnectionView({ instance_id: 'core', operation }, 'agent').operation, operation)
  assert.equal(decodeAgentResourceConnectionView({
    instance_id: 'core', operation: { ...operation, source_binding: null },
  }, 'agent').operation?.source_binding, null)
  assert.deepEqual(decodeAgentResourceConnectionView({
    instance_id: 'core', operation: { ...operation, source_binding: profileBinding },
  }, 'agent').operation?.source_binding, profileBinding)
  const result_session = agentSessionFixture({ id: 'agent', resource_bindings: [resultBinding] })
  assert.equal(decodeAgentResourceConnectionView({
    instance_id: 'core', operation: { ...operation, status: 'succeeded', result_session },
  }, 'agent').operation?.result_session?.id, 'agent')
  const longName = '长期生产环境'.repeat(50)
  assert.equal(decodeAgentResourceConnectionView({
    instance_id: 'core', operation: {
      ...operation,
      target: { ...target, host_name: longName, profile_name: longName },
    },
  }, 'agent').operation?.target.host_name, longName)
})

test('Profile 连接协议拒绝跨会话、跨实例、敏感或非法目标与错误成功结果', () => {
  for (const patch of [
    { session_id: 'other' }, { instance_id: 'other' }, { kind: 'file_profile' }, { status: 'unknown' },
    { target: { ...target, platform: 'windows' } }, { source_binding: { ...binding, kind: 'file_profile' } },
    { target: { ...target, host_name: '长期生产环境'.repeat(60) } },
    { revision: 0 }, { retryable: 'yes' }, { created_at: 'yesterday' },
    { result_session: agentSessionFixture({ id: 'agent' }) },
    { status: 'succeeded' },
    { status: 'succeeded', result_session: agentSessionFixture({ id: 'other' }) },
    { status: 'succeeded', result_session: agentSessionFixture({ id: 'agent' }) },
    { status: 'succeeded', result_session: agentSessionFixture({
      id: 'agent', resource_bindings: [{ ...resultBinding, host_id: 'host-other' }],
    }) },
    { status: 'succeeded', result_session: agentSessionFixture({
      id: 'agent', resource_bindings: [{ ...resultBinding, ssh_profile_id: 'profile-other' }],
    }) },
  ]) assert.throws(() => decodeAgentResourceConnectionView({
    instance_id: 'core', operation: { ...operation, ...patch },
  }, 'agent'))
  for (const value of [
    { instance_id: 'core' },
    { instance_id: '', operation: null },
    { instance_id: 'core', operation: undefined },
  ]) assert.throws(() => decodeAgentResourceConnectionView(value, 'agent'))
})
