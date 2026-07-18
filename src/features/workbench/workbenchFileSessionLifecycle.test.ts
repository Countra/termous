import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession, Session } from '../../types/domain.ts'
import {
  buildSourceSessionContexts,
  canApplyCreatedFileSession,
  isCurrentSourceSession,
} from './workbenchFileSessionLifecycle.ts'

function sshSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    kind: 'ssh',
    host_id: 'host-1',
    status: 'connected',
    started_at: '2026-07-18T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'file-session-1',
    host_id: 'host-1',
    source_session_id: 'session-1',
    status: 'connected',
    current_path: '/',
    started_at: '2026-07-18T00:00:00Z',
    ...overrides,
  }
}

test('CWD 更新期间仍接受同一活动 source 的文件会话创建响应', () => {
  const contexts = buildSourceSessionContexts([sshSession()])

  assert.equal(
    canApplyCreatedFileSession(fileSession(), contexts, 'session-1', 'host-1'),
    true,
  )
})

test('source 断开、移除或 host 改变后拒绝旧创建响应', () => {
  const disconnected = buildSourceSessionContexts([
    sshSession({ status: 'disconnected' }),
  ])
  const changedHost = buildSourceSessionContexts([
    sshSession({ host_id: 'host-2' }),
  ])

  assert.equal(isCurrentSourceSession(disconnected, 'session-1', 'host-1'), false)
  assert.equal(isCurrentSourceSession(new Map(), 'session-1', 'host-1'), false)
  assert.equal(isCurrentSourceSession(changedHost, 'session-1', 'host-1'), false)
})

test('响应的 source 或 host 不匹配时拒绝写入前端状态', () => {
  const contexts = buildSourceSessionContexts([sshSession()])

  assert.equal(
    canApplyCreatedFileSession(
      fileSession({ source_session_id: 'session-2' }),
      contexts,
      'session-1',
      'host-1',
    ),
    false,
  )
  assert.equal(
    canApplyCreatedFileSession(
      fileSession({ host_id: 'host-2' }),
      contexts,
      'session-1',
      'host-1',
    ),
    false,
  )
})
