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

test('慢启动和 services 分别保留两分钟预算，数据库处理不被启动期限截断', () => {
  const { state } = createState()
  assert.equal(state.hasReadyTimedOut(45_000), false)
  assert.equal(state.hasReadyTimedOut(119_999), false)
  assert.equal(state.hasReadyTimedOut(120_000), true)
  state.accept(event(1, { database: { status: 'checking' } }), 100)
  assert.equal(state.hasReadyTimedOut(600_000), false)
  state.accept(event(2, { phase: 'services', database: { status: 'completed', operation: 'upgrade' } }), 600_000)
  assert.equal(state.hasReadyTimedOut(645_000), false)
  assert.equal(state.hasReadyTimedOut(719_999), false)
  assert.equal(state.hasReadyTimedOut(720_000), true)
})

test('启动心跳和迟到阶段不能无限续期，新实例独立计时', () => {
  const { state } = createState()
  state.accept(event(1, { phase: 'starting', heartbeat: true }), 110_000)
  assert.equal(state.hasReadyTimedOut(119_000), false)
  state.accept(event(2, { phase: 'services' }), 119_000)
  state.accept(event(3, { phase: 'services', heartbeat: true }), 238_000)
  assert.equal(state.accept(event(4), 238_500), false)
  assert.equal(state.hasReadyTimedOut(238_999), false)
  assert.equal(state.hasReadyTimedOut(239_000), true)
  state.beginInstance('instance-2', 250_000)
  state.bindPID(456)
  assert.equal(state.accept(event(5, { phase: 'services' }), 300_000), false)
  assert.equal(state.hasReadyTimedOut(369_999), false)
  assert.equal(state.hasReadyTimedOut(370_000), true)
})

test('超时后的服务事件不能重新打开等待，明确错误仍保留', () => {
  const { state } = createState()
  assert.equal(state.accept(event(1, { phase: 'starting', heartbeat: true }), 120_000), false)
  assert.equal(state.accept(event(2, { phase: 'services' }), 121_000), false)
  assert.equal(state.hasReadyTimedOut(121_000), true)
  const error = { code: 'CORE_START_FAILED', message: '启动资源不可用' }
  assert.equal(state.accept(event(3, { phase: 'failed', error }), 122_000), true)
  assert.deepEqual(state.getPendingFailure(), error)
})

test('终态失败前收到迟到的首次数据库快照仍安全等待，失败后不能重新打开', () => {
  const { state } = createState()
  assert.equal(state.accept(event(1), 130_000), true)
  assert.equal(state.hasReadyTimedOut(600_000), false)
  state.fail({ code: 'DB_MIGRATION_FAILED', message: '数据库处理失败' }, 610_000)
  assert.equal(state.accept(event(2), 620_000), false)
  assert.equal(state.getSnapshot().phase, 'failed')
})

test('系统日期前跳或回拨不影响启动期限与静默判断，快照仍保留真实日期', () => {
  let elapsed = 0
  const state = new CoreStartupState(undefined, () => elapsed)
  const wallTime = Date.parse('2026-11-01T12:00:00Z')
  state.begin('attempt', wallTime)
  state.beginInstance('instance-1', wallTime)
  state.bindPID(123)
  elapsed = 45_000
  assert.equal(state.hasReadyTimedOut(wallTime + 3_600_000), false)
  elapsed = 120_000
  assert.equal(state.hasReadyTimedOut(wallTime - 3_600_000), true)
  state.beginInstance('instance-1', wallTime - 3_600_000)
  state.bindPID(123)
  state.accept(event(1), wallTime - 3_600_000)
  elapsed += 59_999
  state.tick(wallTime + 3_600_000)
  assert.equal(state.getSnapshot().attention, null)
  elapsed += 1
  state.tick(wallTime - 7_200_000)
  assert.equal(state.getSnapshot().attention, 'unresponsive')
  assert.equal(state.getSnapshot().updatedAt, new Date(wallTime - 7_200_000).toISOString())
})

test('空闲、外部 Core 和终态不适用托管启动期限', () => {
  assert.equal(new CoreStartupState().hasReadyTimedOut(1_000_000), false)
  const { state } = createState()
  state.setExternal(100)
  assert.equal(state.hasReadyTimedOut(1_000_000), false)
  state.ready(200)
  assert.equal(state.hasReadyTimedOut(1_000_000), false)
  state.fail({ code: 'CORE_PROCESS_EXITED', message: '已退出' }, 300)
  assert.equal(state.hasReadyTimedOut(1_000_000), false)
})

test('心跳消失仅提示无法确认，慢迁移提示保持，心跳不反复广播状态', () => {
  const { state, changes } = createState()
  state.accept(event(1), 100)
  const count = changes.length
  state.accept(event(2, { heartbeat: true }), 2000)
  assert.equal(changes.length, count)
  state.tick(32_000)
  assert.equal(state.getSnapshot().attention, null)
  state.tick(61_999)
  assert.equal(state.getSnapshot().attention, 'slow')
  state.tick(62_000)
  assert.equal(state.getSnapshot().attention, 'unresponsive')
  state.accept(event(3, { heartbeat: true }), 62_001)
  assert.equal(state.getSnapshot().attention, 'slow')
  const slowCount = changes.length
  state.accept(event(4, { heartbeat: true }), 64_100)
  state.tick(64_101)
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

test('单库完成不放行服务，领域故障在完整快照中保留到就绪', () => {
  const { state } = createState()
  const core = { id: '1-51', domain: 'core', role: 'live', status: 'completed', confirmedVersion: 51 } as const
  const agent = { id: '2-2', domain: 'agent', role: 'live', status: 'failed', targetVersion: 2, code: 'DB_MIGRATION_FAILED' } as const
  state.accept(event(1, { database: core, databases: [core] }), 100)
  assert.equal(state.getSnapshot().phase, 'database')
  state.accept(event(2, { phase: 'services', database: agent, databases: [core, agent] }), 200)
  state.ready(300)
  assert.equal(state.getSnapshot().phase, 'ready')
  assert.equal(state.getSnapshot().failure, null)
  assert.deepEqual(state.getSnapshot().databases, [core, agent])
})

test('换端口不短暂显示可重试失败，新实例重新确认各库版本', () => {
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
  assert.deepEqual(state.getSnapshot().database, { status: 'unchanged' })
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
