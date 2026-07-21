import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession, FileSessionStatus, SessionStatus } from '../types/domain.ts'
import {
  mergeFileSessionUpdate,
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
