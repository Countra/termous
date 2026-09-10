import assert from 'node:assert/strict'
import test from 'node:test'
import type { CoreStartupSnapshot } from '../common/contracts/startup.ts'
import type { CoreStartupEvent } from './coreStartupProtocol.ts'
import { CoreStartupState } from './coreStartupState.ts'

function createState() {
  const changes: CoreStartupSnapshot[] = []
  const state = new CoreStartupState((snapshot) => changes.push(snapshot))
  state.begin('attempt-1', 0)
  state.beginInstance('instance-1', 0)
  state.bindPID(123)
  return { state, changes }
}

function event(sequence: number, fields: Partial<CoreStartupEvent> = {}): CoreStartupEvent {
  return {
    protocol: 1, instanceId: 'instance-1', pid: 123, sequence,
    at: '2026-09-07T12:00:00Z', phase: 'database',
    database: { status: 'running', operation: 'upgrade', fromVersion: 25, targetVersion: 37 },
    ...fields,
  }
}

test('普通启动超时有界，数据库处理超过 12 秒仍继续等待，services 后重新计时', () => {
  const { state } = createState()
  assert.equal(state.hasReadyTimedOut(11_999), false)
  assert.equal(state.hasReadyTimedOut(12_000), true)
  state.accept(event(1, { database: { status: 'checking' } }), 100)
  assert.equal(state.hasReadyTimedOut(120_000), false)
  state.accept(event(2, { phase: 'services', database: { status: 'completed', operation: 'upgrade' } }), 120_000)
  assert.equal(state.hasReadyTimedOut(131_999), false)
  assert.equal(state.hasReadyTimedOut(132_000), true)
})

test('心跳消失仅提示无法确认，慢迁移提示保持，心跳不反复广播状态', () => {
  const { state, changes } = createState()
  state.accept(event(1), 100)
  const count = changes.length
  state.accept(event(2, { heartbeat: true }), 2000)
  assert.equal(changes.length, count)
  state.tick(17_000)
  assert.equal(state.getSnapshot().attention, 'unresponsive')
  state.accept(event(3, { heartbeat: true }), 17_001)
  assert.equal(state.getSnapshot().attention, null)
  state.accept(event(4, { heartbeat: true }), 60_100)
  assert.equal(state.getSnapshot().attention, 'slow')
  const slowCount = changes.length
  state.accept(event(5, { heartbeat: true }), 62_100)
  state.tick(62_101)
  assert.equal(changes.length, slowCount)
  assert.equal(state.hasReadyTimedOut(100_000), false)
})

test('旧实例、错误 PID、重复序号和已结束阶段不会覆盖当前状态', () => {
  const { state } = createState()
  assert.equal(state.accept(event(1, { instanceId: 'old-instance' }), 100), false)
  assert.equal(state.accept(event(1, { pid: 456 }), 100), false)
  assert.equal(state.accept(event(2), 100), true)
  assert.equal(state.accept(event(1), 200), false)
  state.accept(event(3, { phase: 'services' }), 300)
  assert.equal(state.accept(event(4), 400), false)
  state.ready(500)
  assert.equal(state.accept(event(5, { phase: 'services' }), 600), false)
  assert.equal(state.getSnapshot().phase, 'ready')
})

test('明确数据库失败保留原因与确认版本，通用退出错误和迟到完成不能覆盖', () => {
  const { state } = createState()
  const failure = { code: 'DB_MIGRATION_FAILED', message: '磁盘空间不足', migrationVersion: 31, confirmedVersion: 30 }
  state.accept(event(1, { phase: 'failed', error: failure, database: { status: 'failed' } }), 100)
  state.fail({ code: 'CORE_PROCESS_EXITED', message: '进程已退出' }, 200)
  state.ready(300)
  assert.equal(state.accept(event(2, { phase: 'services' }), 400), false)
  assert.deepEqual(state.getSnapshot().failure, failure)
  assert.equal(state.getSnapshot().phase, 'failed')
})

test('换端口保留已完成迁移摘要且不短暂显示可重试的失败', () => {
  const { state } = createState()
  const database = { status: 'completed', operation: 'upgrade', confirmedVersion: 37 } as const
  state.accept(event(1, { phase: 'services', database }), 100)
  state.accept(event(2, { phase: 'failed', error: { code: 'CORE_BIND_FAILED', message: '端口占用' } }), 200)
  assert.equal(state.getSnapshot().phase, 'services')
  assert.equal(state.getPendingFailure()?.code, 'CORE_BIND_FAILED')
  state.beginInstance('instance-2', 300)
  state.bindPID(456)
  assert.equal(state.getPendingFailure(), null)
  state.accept(event(1, { instanceId: 'instance-2', pid: 456, database: { status: 'unchanged' } }), 400)
  assert.deepEqual(state.getSnapshot().database, database)
})

test('恢复重启创建全新状态但 revision 全局递增，外部 Core 不伪造迁移状态', () => {
  const { state } = createState()
  state.accept(event(1), 100)
  state.ready(200)
  const revision = state.getSnapshot().revision
  state.begin('attempt-2', 300)
  assert.equal(state.getSnapshot().database, null)
  assert.ok(state.getSnapshot().revision > revision)
  state.setExternal(400)
  assert.equal(state.getSnapshot().phase, 'external')
  assert.equal(state.getSnapshot().instanceId, null)
})

test('订阅方修改快照不影响权威状态', () => {
  const { state, changes } = createState()
  state.accept(event(1), 100)
  changes[changes.length - 1].database!.targetVersion = 99
  assert.equal(state.getSnapshot().database?.targetVersion, 37)
})
