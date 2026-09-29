import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { NotificationMessage } from '#common/contracts'
import { NotificationRuntime } from './runtime.ts'

function message(sequence: number, patch: Partial<NotificationMessage> = {}): NotificationMessage {
  return { id: String(sequence), sequence, source_id: `task-${sequence}`, kind: 'file', outcome: 'success', occurred_at: new Date().toISOString(), operation: 'upload_file', completed_files: 1, total_files: 1, skipped_items: 0, native_eligible: true, read: false, ...patch }
}
class Native extends EventEmitter {
  shown = 0
  closed = 0
  show() { this.shown++ }
  close() { this.closed++ }
}

test('审批即时提醒、快照决策后释放原生通知且过期不补发', () => {
  const natives: Native[] = []
  let allowApprovals = true
  const runtime = new NotificationRuntime({ background: () => true, supported: () => true, preferences: () => ({ enabled: true, agent: true, file: true, cloud: true, approval: allowApprovals }), language: () => 'zh-CN', create: (title, body) => { assert.match(title, /有命令待审批/); assert.match(body, /AI 助手/); const n = new Native(); natives.push(n); return n }, activate() {}, warn() {} })
  runtime.accept({ type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } })
  const approval = message(1, { kind: 'approval', outcome: 'attention', operation: 'command', expires_at: new Date(Date.now() + 60000).toISOString() })
  runtime.accept({ type: 'upsert', message: approval })
  assert.equal(natives.length, 1)
  runtime.accept({ type: 'snapshot', page: { items: [], watermark: 1, unread_count: 0, next_before: 0 } })
  assert.equal(natives[0].closed, 1)
  runtime.accept({ type: 'upsert', message: { ...approval, id: 'expired', sequence: 2, expires_at: new Date(Date.now() - 1000).toISOString() } })
  assert.equal(natives.length, 1)
  allowApprovals = false
  runtime.accept({ type: 'upsert', message: { ...approval, id: 'disabled', sequence: 3 } })
  assert.equal(natives.length, 1)
  runtime.close()
})

test('启动不重弹历史，重连去重且过期与 MCP 结果不投递', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const natives: Native[] = []
  const runtime = new NotificationRuntime({ background: () => true, supported: () => true, preferences: () => ({ enabled: true, agent: true, file: true, cloud: true, approval: true }), language: () => 'zh-CN', create: () => { const native = new Native(); natives.push(native); return native }, activate() {}, warn() {} })
  runtime.accept({ type: 'snapshot', page: { items: [message(1)], watermark: 1, unread_count: 1, next_before: 0 } })
  runtime.accept({ type: 'snapshot', page: { items: [message(4, { native_eligible: false }), message(3, { occurred_at: new Date(Date.now() - 121_000).toISOString() }), message(2), message(1)], watermark: 4, unread_count: 4, next_before: 0 } })
  runtime.accept({ type: 'upsert', message: message(2) })
  t.mock.timers.tick(2000)
  assert.equal(natives.length, 1)
  assert.equal(natives[0].shown, 1)
  runtime.close()
  assert.equal(natives[0].closed, 1)
})

test('文件结果合并、窗口恢复抑制投递，点击意图保留到明确确认', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let background = true
  const natives: Native[] = []
  let activated = 0
  const summaries: string[] = []
  const runtime = new NotificationRuntime({ background: () => background, supported: () => true, preferences: () => ({ enabled: true, agent: true, file: true, cloud: true, approval: true }), language: () => 'en-US', create: (_title, body) => { summaries.push(body); const n = new Native(); natives.push(n); return n }, activate: () => { activated++ }, warn() {} })
  runtime.accept({ type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } })
  runtime.accept({ type: 'upsert', message: message(1) })
  background = false
  t.mock.timers.tick(2000)
  assert.equal(natives.length, 0)
  background = true
  runtime.accept({ type: 'upsert', message: message(2, { name: 'video.mp4' }) })
  runtime.accept({ type: 'upsert', message: message(3, { outcome: 'failed', name: 'archive.zip' }) })
  t.mock.timers.tick(2000)
  assert.equal(natives.length, 1)
  assert.equal(summaries[0], '1 completed · 1 need attention\nvideo.mp4, archive.zip')
  natives[0].emit('click')
  assert.equal(activated, 1)
  const pending = runtime.pending()
  assert.equal(pending[0].target.kind, 'centre')
  assert.equal(pending[0].messages.length, 2)
  assert.deepEqual(runtime.pending(), pending)
  runtime.acknowledge(pending[0].id)
  assert.deepEqual(runtime.pending(), [])
  runtime.close()
})

test('最多三个原生对象，投递失败不循环重试', () => {
  const natives: Native[] = []
  let warnings = 0
  const runtime = new NotificationRuntime({ background: () => true, supported: () => true, preferences: () => ({ enabled: true, agent: true, file: true, cloud: true, approval: true }), language: () => 'en-US', create: () => { const n = new Native(); natives.push(n); return n }, activate() {}, warn: () => { warnings++ } })
  runtime.accept({ type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } })
  for (let i = 1; i <= 4; i++) runtime.accept({ type: 'upsert', message: message(i, { kind: 'agent', operation: 'run', session_id: 'session' }) })
  assert.equal(natives[0].closed, 1)
  natives[3].emit('failed')
  assert.equal(warnings, 1)
  assert.equal(natives[3].closed, 1)
  runtime.accept({ type: 'upsert', message: message(4) })
  assert.equal(natives.length, 4)
  runtime.close()
})

test('合并等待期间已读或移除的文件结果不再投递，也不参与点击分组', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const natives: Native[] = []
  const runtime = new NotificationRuntime({ background: () => true, supported: () => true, preferences: () => ({ enabled: true, agent: true, file: true, cloud: true, approval: true }), language: () => 'zh-CN', create: () => { const n = new Native(); natives.push(n); return n }, activate() {}, warn() {} })
  runtime.accept({ type: 'snapshot', page: { items: [], watermark: 0, unread_count: 0, next_before: 0 } })
  for (let i = 1; i <= 3; i++) runtime.accept({ type: 'upsert', message: message(i) })
  runtime.accept({ type: 'snapshot', page: { items: [message(3), message(1, { read: true })], watermark: 3, unread_count: 1, next_before: 0 } })
  t.mock.timers.tick(2000)
  assert.equal(natives.length, 1)
  natives[0].emit('click')
  assert.deepEqual(runtime.pending()[0].messages.map((m) => m.id), ['3'])
  assert.deepEqual(runtime.pending()[0].target, { kind: 'transfer', transfer_id: 'task-3' })
  runtime.accept({ type: 'upsert', message: message(4) })
  runtime.accept({ type: 'snapshot', page: { items: [message(3)], watermark: 4, unread_count: 1, next_before: 0 } })
  t.mock.timers.tick(2000)
  assert.equal(natives.length, 1)
  runtime.close()
})
