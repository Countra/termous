import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession, Session } from '../../types/domain.ts'
import {
  buildSourceSessionContexts,
  canApplyCreatedFileSession,
  isCurrentSourceSession,
  shouldNotifyFileSessionRecoveryFailure,
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

test('恢复错误按 source 和事务去重，切换 source 后不会重复通知原事务', () => {
  const notified = new Map<string, Set<number>>()
  const failed = { phase: 'failed' as const, transaction: 3 }

  assert.equal(shouldNotifyFileSessionRecoveryFailure(notified, 'source-a', failed), true)
  assert.equal(shouldNotifyFileSessionRecoveryFailure(notified, 'source-b', failed), true)
  assert.equal(shouldNotifyFileSessionRecoveryFailure(notified, 'source-a', failed), false)
})

test('新事务允许通知，恢复成功后清理当前 source 的历史', () => {
  const notified = new Map<string, Set<number>>()

  assert.equal(shouldNotifyFileSessionRecoveryFailure(
    notified,
    'source-a',
    { phase: 'failed', transaction: 1 },
  ), true)
  assert.equal(shouldNotifyFileSessionRecoveryFailure(
    notified,
    'source-a',
    { phase: 'failed', transaction: 2 },
  ), true)
  assert.equal(shouldNotifyFileSessionRecoveryFailure(
    notified,
    'source-a',
    { phase: 'idle', transaction: 2 },
  ), false)
  assert.equal(notified.has('source-a'), false)
})

test('恢复通知历史对 source 和事务数量均有界', () => {
  const notified = new Map<string, Set<number>>()

  for (let transaction = 1; transaction <= 5; transaction += 1) {
    shouldNotifyFileSessionRecoveryFailure(
      notified,
      'source-current',
      { phase: 'failed', transaction },
    )
  }
  assert.deepEqual([...notified.get('source-current')!], [2, 3, 4, 5])

  for (let source = 0; source < 32; source += 1) {
    shouldNotifyFileSessionRecoveryFailure(
      notified,
      `source-${source}`,
      { phase: 'failed', transaction: 1 },
    )
  }
  assert.equal(notified.size, 32)
  assert.equal(notified.has('source-current'), false)
})
