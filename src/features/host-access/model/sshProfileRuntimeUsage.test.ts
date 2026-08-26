import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession } from '#entities/file'
import type { Session } from '#entities/session'
import { countSSHProfileRuntimeUsage } from './sshProfileRuntimeUsage.ts'

test('SSH Profile 运行时影响只统计精确匹配的活动 Terminal 和 FileSession', () => {
  const sessions = [
    session('terminal-connecting', 'ssh-target', 'connecting'),
    session('terminal-ready', 'ssh-target', 'connected'),
    session('terminal-failed', 'ssh-target', 'failed'),
    session('terminal-other', 'ssh-other', 'connected'),
    { ...session('local', '', 'connected'), kind: 'local' as const },
  ]
  const fileSessions = [
    fileSession('file-ready', 'ssh-target', 'connected'),
    fileSession('file-waiting', 'ssh-target', 'waiting_trust'),
    fileSession('file-failed', 'ssh-target', 'failed'),
    fileSession('file-other', 'ssh-other', 'connected'),
  ]

  assert.deepEqual(countSSHProfileRuntimeUsage('ssh-target', sessions, fileSessions), {
    terminalSessions: 2,
    fileSessions: 2,
    total: 4,
  })
})

test('空 Profile ID 不会误计缺少身份的历史会话', () => {
  assert.deepEqual(countSSHProfileRuntimeUsage('', [session('terminal', '', 'connected')], []), {
    terminalSessions: 0,
    fileSessions: 0,
    total: 0,
  })
})

function session(id: string, sshProfileId: string, status: Session['status']): Session {
  return {
    id,
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-a',
    ssh_profile_id: sshProfileId || undefined,
    status,
    started_at: '2026-08-26T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}

function fileSession(
  id: string,
  sshProfileId: string,
  status: FileSession['status'],
): FileSession {
  return {
    id,
    host_id: 'host-a',
    file_access_profile_id: `file-${sshProfileId}`,
    ssh_profile_id: sshProfileId,
    engine: 'sftp',
    namespace: 'posix',
    capabilities: ['browse'],
    origin: 'app',
    status,
    current_path: '/',
    started_at: '2026-08-26T00:00:00Z',
  }
}
