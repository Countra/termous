import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession, FileSessionStatus, Session, SessionStatus } from '../types/domain.ts'
import {
  buildSourceSessionContexts,
  canUseSourceFileSession,
  mergeFileSessionUpdate,
  resolveSourceFileSession,
  shouldMaintainFileSessionEventStream,
} from '../features/workbench/workbenchFileSessionLifecycle.ts'

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'fs-1',
    host_id: 'host-1',
    source_session_id: 'session-1',
    status: 'connecting',
    phase: 'queued',
    progress: 5,
    current_path: '/',
    started_at: '2026-07-21T00:00:00Z',
    ...overrides,
  }
}

function sourceSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    host_id: 'host-1',
    kind: 'ssh',
    status: 'connected',
    phase: 'ready',
    pty_cols: 120,
    pty_rows: 32,
    started_at: '2026-07-21T00:00:00Z',
    ...overrides,
  }
}

test('源 SSH 活跃时为仍可能产生事件的文件会话保持事件流', () => {
  for (const status of ['connecting', 'connected', 'waiting_trust'] satisfies FileSessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, status), true)
  }
})

test('源 SSH 断开、失败或已有结束时间时停止文件会话事件流', () => {
  for (const status of ['disconnected', 'failed'] satisfies SessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream(status, undefined, 'connected'), false)
  }
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', '2026-07-19T12:00:00Z', 'connected'),
    false,
  )
})

test('源 SSH 开始关闭后立即停止文件会话事件流', () => {
  for (const status of ['connecting', 'connected', 'waiting_trust'] satisfies FileSessionStatus[]) {
    assert.equal(
      shouldMaintainFileSessionEventStream('connected', undefined, status, true),
      false,
    )
  }
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', undefined, 'connected', false),
    true,
  )
})

test('源会话权威状态阻止删除成功后的旧文件会话复活并允许删除失败恢复', () => {
  const override = fileSession({ status: 'connected', phase: 'ready', progress: 100 })
  const activeContexts = buildSourceSessionContexts([sourceSession()])
  const removedContexts = buildSourceSessionContexts([])
  const noClosingSessions = new Set<string>()
  const closingSourceA = new Set(['session-1'])

  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(resolveSourceFileSession(true, override, undefined), override)

  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', closingSourceA), false)
  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(canUseSourceFileSession(removedContexts, 'session-1', 'host-1', noClosingSessions), false)
  assert.equal(resolveSourceFileSession(false, override, override), null)
})

test('异步文件请求按所属 source 校验，不受活动远程或本地页签切换干扰', () => {
  const contexts = buildSourceSessionContexts([
    sourceSession(),
    sourceSession({ id: 'session-2', host_id: 'host-2' }),
  ])
  const noClosingSessions = new Set<string>()
  const closingSourceA = new Set(['session-1'])
  const closingSourceB = new Set(['session-2'])

  // 切换到 B 或本地页签不会让仍存活的 A 响应失效。
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', closingSourceB), true)

  // 后台关闭 A 只阻断 A；删除失败移除 closing 后，同一 source 可以恢复。
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', closingSourceA), false)
  assert.equal(canUseSourceFileSession(contexts, 'session-2', 'host-2', closingSourceA), true)
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', noClosingSessions), true)
})

test('文件会话进入终止态或不存在时停止事件流', () => {
  for (const status of ['disconnected', 'failed'] satisfies FileSessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, status), false)
  }
  assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, null), false)
})

test('同一次文件连接的乱序更新不会让进度回退', () => {
  const waiting = fileSession({
    status: 'waiting_trust',
    phase: 'waiting_host_trust',
    progress: 55,
    status_message: '等待确认主机指纹',
  })
  const resumed = mergeFileSessionUpdate(waiting, fileSession({
    phase: 'resolving_auth',
    progress: 18,
    status_message: '主机指纹已确认，正在继续连接',
  }))

  assert.equal(resumed.progress, 55)
  assert.equal(resumed.phase, 'resolving_auth')
  assert.equal(resumed.status_message, '主机指纹已确认，正在继续连接')
  assert.equal(mergeFileSessionUpdate(resumed, fileSession({
    phase: 'sftp_handshake',
    progress: 78,
  })).progress, 78)
})

test('明确重连允许新一轮进度重置并拒绝终态后的旧连接快照', () => {
  const failed = fileSession({ status: 'failed', phase: 'failed', progress: 100 })
  const reconnecting = fileSession({ status: 'connecting', phase: 'queued', progress: 5 })

  assert.equal(mergeFileSessionUpdate(failed, reconnecting), failed)
  assert.equal(mergeFileSessionUpdate(failed, reconnecting, true).progress, 5)

  const connected = fileSession({ status: 'connected', phase: 'ready', progress: 100 })
  assert.equal(mergeFileSessionUpdate(connected, reconnecting), connected)
})
