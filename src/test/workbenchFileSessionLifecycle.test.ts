import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSessionStatus, SessionStatus } from '../types/domain.ts'
import { shouldMaintainFileSessionEventStream } from '../features/workbench/workbenchFileSessionLifecycle.ts'

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
