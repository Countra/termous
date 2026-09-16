import assert from 'node:assert/strict'
import test from 'node:test'
import { resourceBindingMatchesSource } from './resourceReference.ts'
import type {
  AgentFileResourceBinding,
  AgentFileResourceState,
  AgentResourceBinding,
  AgentSSHProfileResourceBinding,
  AgentSSHProfileResourceState,
  AgentSSHResourceBinding,
  AgentSSHResourceState,
} from './types.ts'

test('SSH Profile 绑定必须匹配主机、Profile 和平台', () => {
  const source = sshProfileSource()
  const binding = sshProfileBinding()

  assert.equal(resourceBindingMatchesSource(binding, source), true)
  assert.equal(resourceBindingMatchesSource({ ...binding, host_id: 'host-other' }, source), false)
  assert.equal(resourceBindingMatchesSource({ ...binding, ssh_profile_id: 'profile-other' }, source), false)
  // 领域合同只允许 linux，这里通过未知值模拟运行时收到的畸形回执。
  assert.equal(resourceBindingMatchesSource(
    { ...binding, platform: 'windows' } as unknown as AgentResourceBinding,
    source,
  ), false)
})

test('SSH Profile 不会误匹配同主机同 Profile 的 SSH 会话绑定', () => {
  assert.equal(resourceBindingMatchesSource(sshSessionBinding(), sshProfileSource()), false)
})

test('SSH 会话按完整身份匹配，文件 Profile 只按稳定身份匹配', () => {
  const session = sshSessionSource()
  const sessionBinding = sshSessionBinding()
  assert.equal(resourceBindingMatchesSource(sessionBinding, session), true)
  assert.equal(resourceBindingMatchesSource({ ...sessionBinding, session_id: 'session-other' }, session), false)

  const file = fileProfileSource()
  const fileBinding = fileProfileBinding()
  assert.equal(resourceBindingMatchesSource(fileBinding, file), true)
  assert.equal(resourceBindingMatchesSource({ ...fileBinding, ssh_profile_id: 'profile-other' }, file), true)
  assert.equal(resourceBindingMatchesSource({ ...fileBinding, host_id: 'host-other' }, file), true)
  assert.equal(resourceBindingMatchesSource({ ...fileBinding, file_access_profile_id: 'file-other' }, file), false)
  assert.equal(resourceBindingMatchesSource({ ...fileBinding, engine: 'webdav' }, file), false)
})

function sshProfileSource(): AgentSSHProfileResourceState {
  return {
    host_id: 'host-one',
    ssh_profile_id: 'profile-one',
    host_name: 'Alpha',
    ssh_profile_name: 'Primary',
    platform: 'linux',
    status: 'ready',
  }
}

function sshProfileBinding(): AgentSSHProfileResourceBinding {
  return {
    kind: 'ssh_profile',
    host_id: 'host-one',
    ssh_profile_id: 'profile-one',
    host_name: 'Alpha',
    ssh_profile_name: 'Primary',
    platform: 'linux',
    bound_at: '2026-09-12T00:00:00Z',
  }
}

function sshSessionSource(): AgentSSHResourceState {
  return {
    ...sshProfileSource(),
    session_id: 'session-one',
    started_at: '2026-09-12T00:00:00Z',
  }
}

function sshSessionBinding(): AgentSSHResourceBinding {
  return {
    kind: 'ssh_session',
    host_id: 'host-one',
    ssh_profile_id: 'profile-one',
    host_name: 'Alpha',
    session_id: 'session-one',
    platform: 'linux',
    bound_at: '2026-09-12T00:00:00Z',
  }
}

function fileProfileSource(): AgentFileResourceState {
  return {
    file_access_profile_id: 'file-one',
    file_access_profile_name: 'Files',
    host_id: 'host-one',
    host_name: 'Alpha',
    ssh_profile_id: 'profile-one',
    engine: 'sftp',
    status: 'ready',
  }
}

function fileProfileBinding(): AgentFileResourceBinding {
  return {
    kind: 'file_profile',
    file_access_profile_id: 'file-one',
    file_access_profile_name: 'Files',
    host_id: 'host-one',
    ssh_profile_id: 'profile-one',
    host_name: 'Alpha',
    engine: 'sftp',
    bound_at: '2026-09-12T00:00:00Z',
  }
}
