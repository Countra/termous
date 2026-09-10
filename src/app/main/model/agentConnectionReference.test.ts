import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentFileResourceState, AgentReferenceTargetsSnapshot } from '#entities/agent'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { buildConnectionReferenceLaunch, projectAgentFileResources, projectConnectionReferenceSnapshot } from './agentConnectionReference.ts'

const file: AgentFileResourceState = { file_access_profile_id: 'file_one', file_access_profile_name: '文件配置',
  host_id: 'host_one', host_name: '主机', ssh_profile_id: 'ssh_one', engine: 'sftp', status: 'ready' }

test('文件候选只依赖配置关系且按 profile 去重，不依赖原文件标签', () => {
  const profile = { id: 'file_one', name: '文件配置', host_id: 'host_one', engine: 'sftp', engine_config_version: 1,
    sftp: { ssh_profile_id: 'ssh_one' } } as FileAccessProfile
  const hosts = [{ id: 'host_one', name: '主机' }] as HostAsset[]
  const ssh = [{ id: 'ssh_one', host_id: 'host_one' }] as SSHAccessProfile[]
  assert.deepEqual(projectAgentFileResources([profile, profile], hosts, ssh), [file])
  assert.equal(projectAgentFileResources([profile], [], ssh)[0]?.status, 'unavailable')
  assert.equal(projectAgentFileResources([profile], hosts, [{ ...ssh[0]!, host_id: 'host_other' }])[0]?.status, 'unavailable')
})

test('纯引用不携带预填文本和来源说明，重命名仍有效，配置身份变化拒绝转交', () => {
  const request = buildConnectionReferenceLaunch(file, { kind: 'new' }, [{ ...file, file_access_profile_name: '已重命名' }])
  assert.deepEqual(request.resource_reference, { kind: 'file_profile', file_access_profile_id: file.file_access_profile_id })
  for (const field of ['text', 'source_context', 'file_session_id']) assert.equal(field in request, false)
  assert.throws(() => buildConnectionReferenceLaunch(file, { kind: 'new' }, []), /SOURCE_UNAVAILABLE/)
  assert.throws(() => buildConnectionReferenceLaunch(file, { kind: 'new' }, [{ ...file, ssh_profile_id: 'changed' }]), /SOURCE_UNAVAILABLE/)
})

test('目标锁定按同类引用判断，另一类引用不能解除锁定', () => {
  const sessions: AgentReferenceTargetsSnapshot = { ready: true, targets: [
    { session_id: 'same', title: '相同配置', binding_locked: true, resource_bindings: [{
      ...file, kind: 'file_profile', bound_at: '2026-09-09T00:00:00Z',
    }] },
    { session_id: 'ssh', title: '已有终端', binding_locked: true, resource_bindings: [{
      kind: 'ssh_session', session_id: 'ssh_session', host_id: file.host_id, ssh_profile_id: file.ssh_profile_id,
      host_name: file.host_name, platform: 'linux', bound_at: '2026-09-09T00:00:00Z',
    }] },
  ] }
  const snapshot = projectConnectionReferenceSnapshot({ kind: 'file_profile', file_access_profile_id: file.file_access_profile_id }, [file], sessions, true)
  assert.deepEqual(snapshot.targets.map(({ disabled }) => disabled), [false, true])
})
