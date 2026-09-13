import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { FileSession } from '#entities/file'
import type { HostAsset } from '#entities/host-asset'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  projectAgentSlashCandidates,
  projectAgentSlashFileProfileCandidates,
  projectAgentSlashFileSessionCandidates,
  projectAgentSlashSSHProfileCandidates,
  projectAgentSlashSSHSessionCandidates,
  type ProjectAgentSlashCandidatesInput,
} from './projectAgentSlashCandidates.ts'

test('SSH 会话保留未就绪项并按可用性和连接时间排序', () => {
  const input = baseInput({
    sessions: [
      sshSession('new-ready', '2026-09-12T10:00:00Z'),
      sshSession('current-old', '2026-09-10T10:00:00Z'),
      sshSession('new-connecting', '2026-09-13T10:00:00Z', { status: 'connecting', phase: 'dialing' }),
      { ...sshSession('local', '2026-09-14T10:00:00Z'), kind: 'local' },
    ],
  })

  const candidates = projectAgentSlashSSHSessionCandidates(input)
  assert.deepEqual(candidates.map(({ session_id }) => session_id), ['new-ready', 'current-old', 'new-connecting'])
  assert.equal(candidates[0]?.current, false)
  assert.equal(candidates[2]?.status, 'connecting')
  assert.equal(candidates[2]?.disabled_reason, 'session_not_ready')
  assert.equal(candidates[0]?.profile_name, 'Primary')
})

test('SSH 会话在 Host 或 Profile 目录身份失效时保留展示但禁止选择', () => {
  const missingHost = projectAgentSlashSSHSessionCandidates(baseInput({
    hosts: [],
    hostAssets: [],
  }))
  assert.equal(missingHost[0]?.disabled_reason, 'host_missing')

  const missingProfile = projectAgentSlashSSHSessionCandidates(baseInput({
    sshAccessProfiles: [],
  }))
  assert.equal(missingProfile[0]?.disabled_reason, 'ssh_profile_missing')

  const wrongHost = projectAgentSlashSSHSessionCandidates(baseInput({
    sshAccessProfiles: [sshProfile('ssh-one', 'host-other')],
  }))
  assert.equal(wrongHost[0]?.disabled_reason, 'profile_host_mismatch')
})

test('文件会话过滤关闭项、按 Profile 聚合并允许断开会话引用有效配置', () => {
  const input = baseInput({
    displayedFileSessions: [
      fileSession('old', 'file-one', '2026-09-10T10:00:00Z', 'connected'),
      fileSession('new', 'file-one', '2026-09-12T10:00:00Z', 'disconnected'),
      fileSession('closing', 'file-two', '2026-09-13T10:00:00Z', 'connected'),
      fileSession('missing', 'file-missing', '2026-09-14T10:00:00Z', 'connected'),
    ],
    closingFileSessionIds: ['closing'],
  })

  const candidates = projectAgentSlashFileSessionCandidates(input)
  assert.deepEqual(candidates.map(({ file_access_profile_id }) => file_access_profile_id), ['file-one', 'file-missing'])
  assert.deepEqual(candidates[0], {
    id: 'session:file:file-one',
    kind: 'file_session',
    resource_kind: 'file',
    host_id: 'host-one',
    host_name: 'Alpha',
    profile_id: 'file-one',
    profile_name: 'Files',
    file_access_profile_id: 'file-one',
    representative_session_id: 'new',
    session_count: 2,
    status: 'disconnected',
    current: false,
  })
  assert.equal(candidates[1]?.disabled_reason, 'profile_missing')
})

test('完整 Profile 目录按结构可用性、主机和既有顺序稳定排序', () => {
  const currentMissingHost = sshProfile('ssh-current', 'host-missing', 'Current', 9)
  const input = baseInput({
    hostAssets: [hostAsset('host-zulu', 'Zulu'), hostAsset('host-alpha', 'Alpha')],
    sshAccessProfiles: [
      currentMissingHost,
      sshProfile('ssh-zulu', 'host-zulu', 'First', 0),
      sshProfile('ssh-alpha-two', 'host-alpha', 'Second', 2),
      sshProfile('ssh-alpha-one', 'host-alpha', 'Third', 1),
    ],
    fileAccessProfiles: [
      fileProfile('file-zulu', 'host-zulu', 'ssh-zulu', 'Z files', 0),
      fileProfile('file-alpha', 'host-alpha', 'ssh-alpha-one', 'A files', 4),
      fileProfile('file-invalid', 'host-alpha', 'ssh-missing', 'Broken', 0),
    ],
  })

  const ssh = projectAgentSlashSSHProfileCandidates(input)
  assert.deepEqual(ssh.map(({ ssh_profile_id }) => ssh_profile_id), [
    'ssh-alpha-one', 'ssh-alpha-two', 'ssh-zulu', 'ssh-current',
  ])
  assert.equal(ssh[3]?.disabled_reason, 'host_missing')

  const files = projectAgentSlashFileProfileCandidates(input)
  assert.deepEqual(files.map(({ file_access_profile_id }) => file_access_profile_id), [
    'file-alpha', 'file-zulu', 'file-invalid',
  ])
  assert.equal(files[2]?.disabled_reason, 'ssh_profile_missing')
  assert.equal(files[0]?.status, 'ready')
})

test('文件 Profile 继承底层 SSH Profile 的结构可用性', () => {
  const input = baseInput({
    sshAccessProfiles: [{ ...sshProfile(), credential_id: '' }],
  })
  assert.equal(projectAgentSlashFileProfileCandidates(input)[0]?.disabled_reason, 'profile_invalid')
  assert.equal(projectAgentSlashFileSessionCandidates(input)[0]?.disabled_reason, 'profile_invalid')
})

test('聚合投影只公开菜单和提交所需的窄字段', () => {
  const catalog = projectAgentSlashCandidates(baseInput())
  const serialized = JSON.stringify(catalog)
  for (const sensitive of ['credential_id', 'address', 'username', 'fingerprint']) {
    assert.equal(serialized.includes(sensitive), false)
  }
  assert.equal(catalog.session.ssh[0]?.kind, 'ssh_session')
  assert.equal(catalog.profile.file[0]?.kind, 'file_profile')
})

function baseInput(overrides: Partial<ProjectAgentSlashCandidatesInput> = {}): ProjectAgentSlashCandidatesInput {
  return {
    sessions: [sshSession('ssh-one', '2026-09-12T10:00:00Z')],
    displayedFileSessions: [fileSession('fs-one', 'file-one', '2026-09-12T10:00:00Z', 'connected')],
    hosts: [host()],
    hostAssets: [hostAsset()],
    sshAccessProfiles: [sshProfile()],
    fileAccessProfiles: [fileProfile()],
    closingFileSessionIds: [],
    ...overrides,
  }
}

function sshSession(id: string, startedAt: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-one',
    ssh_profile_id: 'ssh-one',
    status: 'connected',
    phase: 'ready',
    started_at: startedAt,
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

function fileSession(
  id: string,
  profileId: string,
  startedAt: string,
  status: FileSession['status'],
): FileSession {
  return {
    id,
    host_id: 'host-one',
    file_access_profile_id: profileId,
    ssh_profile_id: 'ssh-one',
    engine: 'sftp',
    origin: 'app',
    status,
    current_path: '/',
    started_at: startedAt,
  }
}

function host(): Host {
  return {
    id: 'host-one',
    name: 'Alpha',
    platform: 'linux',
    group_id: 'group-one',
    address: 'example.test',
    port: 22,
    username: 'termous',
    auth_method: 'password',
    credential_id: 'credential-one',
    tags: [],
    favorite: false,
    fingerprint_policy: 'ask',
  }
}

function hostAsset(id = 'host-one', name = 'Alpha'): HostAsset {
  return {
    id,
    name,
    platform: 'linux',
    group_id: 'group-one',
    tags: [],
    favorite: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}

function sshProfile(id = 'ssh-one', hostId = 'host-one', name = 'Primary', sortOrder = 0): SSHAccessProfile {
  return {
    id,
    host_id: hostId,
    name,
    address: 'example.test',
    port: 22,
    username: 'termous',
    auth_method: 'password',
    credential_id: 'credential-one',
    fingerprint_policy: 'ask',
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}

function fileProfile(
  id = 'file-one',
  hostId = 'host-one',
  sshProfileId = 'ssh-one',
  name = 'Files',
  sortOrder = 0,
): FileAccessProfile {
  return {
    id,
    host_id: hostId,
    name,
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: sshProfileId },
    is_default: sortOrder === 0,
    sort_order: sortOrder,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}
