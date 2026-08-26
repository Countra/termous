import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { FileSession, FileSessionClosureState } from '#entities/file'
import type { Session } from '#entities/session'
import {
  buildSourceSessionContexts,
  canApplyCreatedFileSession,
  canUseSourceFileSession,
  selectWorkbenchCompanionFileProfile,
  selectWorkbenchFileSession,
  selectWorkbenchFileSessionClosure,
  workbenchFileSessionKey,
} from './workbenchFileSessionIdentity.ts'

function sshSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-1',
    ssh_profile_id: 'ssh-1',
    status: 'connected',
    started_at: '2026-08-25T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

function fileProfile(overrides: Partial<FileAccessProfile> = {}): FileAccessProfile {
  return {
    id: 'file-1',
    host_id: 'host-1',
    name: 'SFTP',
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: 'ssh-1' },
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
    ...overrides,
  }
}

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'file-session-1',
    host_id: 'host-1',
    file_access_profile_id: 'file-1',
    ssh_profile_id: 'ssh-1',
    engine: 'sftp',
    namespace: 'posix',
    capabilities: ['browse'],
    origin: 'app',
    source_session_id: 'session-1',
    status: 'connected',
    current_path: '/',
    started_at: '2026-08-25T00:00:00Z',
    ...overrides,
  }
}

test('Workbench 只解析来源 SSH 的唯一伴生 SFTP Profile', () => {
  const source = sshSession()
  const companion = fileProfile()
  assert.equal(selectWorkbenchCompanionFileProfile([companion], source), companion)
  assert.equal(selectWorkbenchCompanionFileProfile([
    companion,
    fileProfile({ id: 'file-duplicate', is_default: false }),
  ], source), undefined)
  assert.equal(selectWorkbenchCompanionFileProfile([
    fileProfile({ sftp: { ssh_profile_id: 'ssh-2' } }),
  ], source), undefined)
})

test('Workbench 候选会话同时匹配 source、Host、File Profile 和 SSH Profile', () => {
  const expected = fileSession()
  const sessions = [
    fileSession({ id: 'wrong-file', file_access_profile_id: 'file-2' }),
    fileSession({ id: 'wrong-ssh', ssh_profile_id: 'ssh-2' }),
    expected,
  ]
  assert.equal(
    selectWorkbenchFileSession(sessions, 'session-1', 'host-1', 'file-1', 'ssh-1'),
    expected,
  )
  assert.equal(
    selectWorkbenchFileSession(sessions, 'session-1', 'host-1', 'file-1', 'ssh-2'),
    sessions[1],
  )
})

test('关闭快照也必须匹配完整 Profile 身份', () => {
  const expected: FileSessionClosureState = { session: fileSession(), phase: 'closing' }
  const closures = { 'session-1': expected }
  assert.equal(
    selectWorkbenchFileSessionClosure(closures, 'session-1', 'host-1', 'file-1', 'ssh-1'),
    expected,
  )
  assert.equal(
    selectWorkbenchFileSessionClosure(closures, 'session-1', 'host-1', 'file-2', 'ssh-1'),
    undefined,
  )
})

test('迟到创建响应必须匹配来源与两级 Profile 身份', () => {
  const contexts = buildSourceSessionContexts([sshSession()])
  assert.equal(
    canApplyCreatedFileSession(
      fileSession(),
      contexts,
      'session-1',
      'host-1',
      'file-1',
      'ssh-1',
    ),
    true,
  )
  assert.equal(
    canApplyCreatedFileSession(
      fileSession({ file_access_profile_id: 'file-old' }),
      contexts,
      'session-1',
      'host-1',
      'file-1',
      'ssh-1',
    ),
    false,
  )
  assert.equal(
    canApplyCreatedFileSession(
      fileSession({ ssh_profile_id: 'ssh-old' }),
      contexts,
      'session-1',
      'host-1',
      'file-1',
      'ssh-1',
    ),
    false,
  )
  assert.equal(
    canUseSourceFileSession(
      contexts,
      'session-1',
      'host-1',
      new Set(['session-1']),
      'ssh-1',
    ),
    false,
  )
})

test('Workbench 会话键覆盖 Profile 身份和连接代际', () => {
  const current = fileSession({ connection_generation: 2 })
  assert.notEqual(
    workbenchFileSessionKey(current),
    workbenchFileSessionKey({ ...current, file_access_profile_id: 'file-2' }),
  )
  assert.notEqual(
    workbenchFileSessionKey(current),
    workbenchFileSessionKey({ ...current, ssh_profile_id: 'ssh-2' }),
  )
  assert.notEqual(
    workbenchFileSessionKey(current),
    workbenchFileSessionKey({ ...current, connection_generation: 3 }),
  )
})
