import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentResourceBinding,
  AgentSlashCandidateCatalog,
  AgentSlashFileProfileCandidate,
  AgentSlashFileSessionCandidate,
  AgentSlashSSHProfileCandidate,
  AgentSlashSSHSessionCandidate,
} from '#entities/agent'
import {
  compactDraftHasPayload,
  compactSlashDisabledReason,
  consumeSlashCaptureText,
  latestSlashCandidate,
  latestSlashMutationCandidate,
  sameSlashCandidateIdentity,
  slashCandidateMatchesBinding,
  slashCaptureMatches,
  slashDisabledReason,
} from './agentSlashExecution.ts'

const sshSession: AgentSlashSSHSessionCandidate = {
  id: 'session:ssh:ssh-one',
  kind: 'ssh_session',
  resource_kind: 'ssh',
  session_id: 'ssh-one',
  host_id: 'host-one',
  host_name: '主机一',
  profile_id: 'profile-one',
  profile_name: '默认配置',
  ssh_profile_id: 'profile-one',
  started_at: '2026-09-12T00:00:00Z',
  status: 'ready',
  current: false,
}

const fileSession: AgentSlashFileSessionCandidate = {
  id: 'session:file:file-one',
  kind: 'file_session',
  resource_kind: 'file',
  host_id: 'host-one',
  host_name: '主机一',
  profile_id: 'file-one',
  profile_name: '文件配置',
  file_access_profile_id: 'file-one',
  representative_session_id: 'file-session-one',
  session_count: 1,
  status: 'connected',
  current: false,
}

const fileProfile: AgentSlashFileProfileCandidate = {
  id: 'profile:file:file-one',
  kind: 'file_profile',
  resource_kind: 'file',
  host_id: 'host-one',
  host_name: '主机一',
  profile_id: 'file-one',
  profile_name: '文件配置',
  file_access_profile_id: 'file-one',
  sort_order: 0,
  status: 'ready',
  current: false,
}

const sshProfile: AgentSlashSSHProfileCandidate = {
  id: 'profile:ssh:profile-one',
  kind: 'ssh_profile',
  resource_kind: 'ssh',
  host_id: 'host-one',
  host_name: '主机一',
  profile_id: 'profile-one',
  profile_name: '默认配置',
  ssh_profile_id: 'profile-one',
  sort_order: 0,
  status: 'ready',
  current: false,
}

const catalog: AgentSlashCandidateCatalog = {
  session: { ssh: [sshSession], file: [fileSession] },
  profile: { ssh: [sshProfile], file: [fileProfile] },
}

test('草稿 CAS 使用 UTF-16 范围并保留命令后的正文', () => {
  const capture = { owner: 'agent-one', start: 0, end: 9, raw_fragment: '/session ' }
  const draft = '/session 继续分析😀日志'
  assert.equal(slashCaptureMatches(draft, capture), true)
  assert.equal(consumeSlashCaptureText(draft, capture), '继续分析😀日志')
  assert.equal(slashCaptureMatches('/profile 继续分析😀日志', capture), false)
  assert.equal(consumeSlashCaptureText('/profile 继续分析😀日志', capture), '/profile 继续分析😀日志')
})

test('compact 只在命令之外仍有正文时允许为新草稿创建会话', () => {
  assert.equal(compactDraftHasPayload('/compact'), false)
  assert.equal(compactDraftHasPayload('/c'), false)
  assert.equal(compactDraftHasPayload('/compact\r\n\t'), false)
  assert.equal(compactDraftHasPayload('/compact\n继续处理'), true)
  assert.equal(compactSlashDisabledReason({
    selected: false,
    draft: '/compact ',
    activeRun: false,
    editing: false,
    busy: false,
    unavailable: false,
  }), 'empty_draft')
})

test('资源候选按命令、类型和稳定 ID 从最新目录复验', () => {
  const selected = latestSlashCandidate(catalog, {
    command_id: 'session',
    resource_kind: 'ssh',
    candidate: sshSession,
    capture: { owner: 'agent-one', start: 0, end: 9, raw_fragment: '/session ' },
  })
  assert.equal(selected, sshSession)
  assert.equal(latestSlashCandidate(catalog, {
    command_id: 'profile',
    resource_kind: 'ssh',
    candidate: sshSession,
    capture: { owner: 'agent-one', start: 0, end: 9, raw_fragment: '/profile ' },
  }), undefined)
})

test('SSH 会话复验连接代次，文件会话只复验最终绑定的 Profile', () => {
  assert.equal(sameSlashCandidateIdentity(sshSession, { ...sshSession, status: 'disconnected' }), false)
  assert.equal(sameSlashCandidateIdentity(sshSession, { ...sshSession, started_at: '2026-09-12T00:01:00Z' }), false)
  assert.equal(sameSlashCandidateIdentity(fileSession, {
    ...fileSession,
    representative_session_id: 'file-session-two',
    session_count: 2,
    status: 'disconnected',
  }), true)
  assert.equal(latestSlashMutationCandidate({
    ...catalog,
    session: { ...catalog.session, file: [] },
  }, {
    command_id: 'session',
    resource_kind: 'file',
    candidate: fileSession,
    capture: { owner: 'agent-one', start: 0, end: 9, raw_fragment: '/session ' },
  }), fileProfile)
  assert.equal(latestSlashMutationCandidate({
    ...catalog,
    profile: { ...catalog.profile, file: [{ ...fileProfile, host_id: 'host-two' }] },
  }, {
    command_id: 'session',
    resource_kind: 'file',
    candidate: fileSession,
    capture: { owner: 'agent-one', start: 0, end: 9, raw_fragment: '/session ' },
  }), undefined)
})

test('当前绑定匹配同时校验资源 ID、Profile 与主机身份', () => {
  const binding: AgentResourceBinding = {
    kind: 'ssh_session',
    session_id: 'ssh-one',
    host_id: 'host-one',
    host_name: '主机一',
    ssh_profile_id: 'profile-one',
    platform: 'linux',
    bound_at: '2026-09-12T00:00:00Z',
  }
  assert.equal(slashCandidateMatchesBinding(sshSession, binding), true)
  assert.equal(slashCandidateMatchesBinding({ ...sshSession, host_id: 'host-two' }, binding), false)
  assert.equal(slashCandidateMatchesBinding({ ...sshSession, ssh_profile_id: 'profile-two' }, binding), false)
  assert.equal(slashCandidateMatchesBinding(sshProfile, binding), true)
  assert.equal(slashCandidateMatchesBinding(sshProfile, {
    kind: 'ssh_profile',
    ssh_profile_id: 'profile-one',
    ssh_profile_name: '默认配置',
    host_id: 'host-one',
    host_name: '主机一',
    platform: 'linux',
    bound_at: '2026-09-12T00:00:00Z',
  }), true)
  assert.equal(slashCandidateMatchesBinding({ ...sshProfile, host_id: 'host-two' }, binding), false)
})

test('禁用原因优先返回会改变命令语义的状态', () => {
  assert.equal(slashDisabledReason({
    activeRun: true,
    editing: true,
    busy: true,
    queued: true,
    connection: true,
  }), 'active_run')
  assert.equal(slashDisabledReason({
    activeRun: false,
    editing: false,
    busy: false,
    queued: true,
    connection: false,
  }), 'queued_messages')
})
