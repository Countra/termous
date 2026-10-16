import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeExecutionState } from './runtimeExecutionState.ts'

const now = Date.parse('2026-10-16T00:00:00Z')
const attachment = { id: 'a', session_id: 's', connection_generation: 1, execution_generation: 2, state: 'ready',
  grant: { id: 'g', expires_at: new Date(now + 20000).toISOString(), idle_expires_at: new Date(now + 10000).toISOString() } }
const acquire = 'termous.desktops.control.acquire'
const get = 'termous.desktops.get'
const release = 'termous.desktops.control.release'
const state = () => new RuntimeExecutionState(() => now, () => true)
const facts = (value: RuntimeExecutionState) => value.snapshot([], []).facts

test('审批未完成与失败回执均不投影为持有授权', () => {
  for (const approval of ['pending', 'dispatching', 'dispatch_conflict', 'rejected', 'expired', 'cancelled']) {
    const value = state()
    value.observe(acquire, 'a', { control: { attachment, approval: { state: approval } } }, {}, approval !== 'pending')
    assert.equal(facts(value)[0]!.values.grant_status, 'needs_verification')
  }
})

test('释放保留附着身份，旧 grant 的迟到回执不能使新授权失效', () => {
  const value = state()
  value.observe(acquire, 'a', { control: { attachment } }, {}, false)
  value.observe(release, 'a', { completed: true }, { attachment_id: 'a', grant_id: 'old' }, false)
  assert.equal(facts(value)[0]!.values.grant_status, 'held')
  value.observe(release, 'a', { completed: true }, { attachment_id: 'a', grant_id: 'g' }, false)
  assert.equal(facts(value)[0]!.values.grant_status, 'released')
  assert.equal(facts(value)[0]!.values.session_id, 's')
  assert.equal(facts(value)[0]!.values.execution_generation, 2)
})

test('重新查询不含 grant 时清除旧授权，输入回执保留独立操作身份且不伪造授权', () => {
  const value = state()
  value.observe(acquire, 'a', { control: { attachment } }, {}, false)
  value.observe(get, 'a', { attachment: { ...attachment, grant: undefined } }, {}, false)
  const args = { attachment_id: 'a', grant_id: 'g' }
  value.observe('termous.desktops.keyboard.key', 'a', { operation: { client_request_id: 'input-1', state: 'accepted' } }, args, false)
  const current = facts(value)[0]!.values
  assert.equal(current.grant_status, 'not_held')
  assert.equal(current.operation_id, 'input-1')
  assert.equal(current.operation_state, 'accepted')
  assert.equal(current.grant_expires_at, undefined)
})

test('连接代次变更与关闭使该会话授权失效，其他会话保持独立', () => {
  const value = state()
  for (const item of [attachment, { ...attachment, id: 'b', session_id: 'other' }]) value.observe(get, item.id, { attachment: item }, {}, false)
  value.observe(get, 'new', { attachment: { ...attachment, id: 'new', execution_generation: 3, grant: undefined } }, {}, false)
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'a')!.values.grant_status, 'needs_verification')
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'b')!.values.grant_status, 'held')
  value.observe('termous.desktops.close', 'other', { completed: true }, { session_id: 'other' }, false)
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'b')!.values.grant_status, 'needs_verification')
})

test('v1/v2 重启恢复为历史，当前附着回执替换历史且任务标识仍可查询', () => {
  const old = state()
  old.observe(acquire, 'a', { control: { attachment } }, {}, false)
  old.observe('termous.commands.dispatch', 's', { task: { id: 'command-1', status: 'running' } }, {}, false)
  for (const version of [1, 2]) {
    const restored = state()
    assert.ok(restored.restore({ ...old.snapshot([], []), version, observations: [], recent: [] }))
    assert.ok(facts(restored).every((fact) => fact.origin === 'historical'))
    assert.equal(facts(restored).find((fact) => fact.values.attachment_id === 'a')!.values.grant_status, 'needs_verification')
    restored.observe(get, 'a', { attachment }, {}, false)
    assert.equal(facts(restored).filter((fact) => fact.values.attachment_id === 'a').length, 1)
    assert.match(restored.summary([], []), /command-1/)
  }
})

test('同运行检查点投影不改变内存授权，快照与摘要均有界', () => {
  const value = state()
  value.observe(acquire, 'a', { control: { attachment } }, {}, false)
  const snapshot = value.snapshot([], [])
  assert.equal(snapshot.version, 2)
  assert.equal(facts(value)[0]!.values.grant_status, 'held')
  assert.ok(value.summary([], []).length <= 2048)
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 48 * 1024)
})

test('无授权状态也只属于最近观察，重启后重新核验而不恢复为当前结论', () => {
  const old = state()
  old.observe(get, 'a', { attachment: { ...attachment, grant: undefined } }, {}, false)
  const restored = state()
  assert.ok(restored.restore(old.snapshot([], [])))
  assert.equal(facts(restored)[0]!.values.grant_status, 'needs_verification')
  assert.equal(facts(restored)[0]!.origin, 'historical')
  restored.observe(get, 'a', { attachment: { ...attachment, grant: undefined } }, {}, false)
  assert.equal(facts(restored)[0]!.values.grant_status, 'not_held')
})

test('长历史说明不能挤掉本轮授权与未解决问题', () => {
  const value = state()
  value.observe(acquire, 'a', { control: { attachment } }, {}, false)
  const summary = value.summary([['a', { pattern_id: 'p', tool_name: acquire, reason: 'repeated_failure', status: 'detected', count: 3,
    guidance: '需要核验已有授权。'.repeat(150), next_tools: Array(8).fill(get) }]], [])
  assert.match(summary, /"grant_status":"held"/)
  assert.match(summary, /repeated_failure/)
  assert.ok(summary.length <= 2048)
})

test('会话回执的失效和代次变化撤销对应附着提示，其他资源不受影响', () => {
  for (const session of [
    { id: 's', status: 'failed', connection_generation: 1 },
    { id: 's', status: 'ready', connection_generation: 2 },
    { id: 's', status: 'ready', connection_generation: 1, desktop: { execution_generation: 3 } },
  ]) {
    const value = state()
    for (const item of [attachment, { ...attachment, id: 'b', session_id: 'other' }]) value.observe(get, item.id, { attachment: item }, {}, false)
    value.observe(get, 's', { session }, { session_id: 's' }, session.status === 'failed')
    assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'a')!.values.grant_status, 'needs_verification')
    assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'b')!.values.grant_status, 'held')
  }
})

test('其他领域正文与旧代次关闭回执不能撤销当前授权', () => {
  const value = state()
  value.observe(get, 'a', { attachment }, {}, false)
  value.observe('termous.commands.get', 's', { session: { id: 's', status: 'failed' } }, {}, false)
  value.observe('termous.desktops.close', 's', { completed: true }, { session_id: 's', connection_generation: 0 }, false)
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'a')!.values.grant_status, 'held')
})

test('审批拒绝的结构化回执即使未设置外层错误也不能表达持有授权', () => {
  const value = state()
  value.observe(acquire, 'a', { control: { attachment, approval: { state: 'rejected' } } }, {}, false)
  assert.equal(facts(value)[0]!.values.grant_status, 'needs_verification')
})

test('会话不存在回执撤销本轮授权提示，其他会话授权保持独立', () => {
  const value = state()
  for (const item of [attachment, { ...attachment, id: 'b', session_id: 'other' }]) value.observe(get, item.id, { attachment: item }, {}, false)
  value.observe(get, 's', { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }, { session_id: 's' }, true)
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'a')!.values.grant_status, 'needs_verification')
  assert.equal(facts(value).find((fact) => fact.values.attachment_id === 'b')!.values.grant_status, 'held')
})
