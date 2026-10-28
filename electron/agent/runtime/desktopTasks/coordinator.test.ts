import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { DesktopTaskCoordinator } from './coordinator.ts'
import { desktopTaskToolResult } from '../../contracts/desktopTaskResult.ts'
import type { DesktopTaskReceipt, DesktopTaskSnapshot } from '../../contracts/desktopTasks.ts'
import { desktopTaskMessage } from '../../contracts/desktopTaskResult.ts'
import { prepareRuntimeCompaction } from '../../context/compaction/runtimeCompactionPreparation.ts'

export function receipt(state = 'running', revision = 1): DesktopTaskReceipt {
  return { tool_call_id: 'call_batch', execution_id: 'desktop_execution_test', revision,
    result: { run: { id: 'desktop_execution_test', revision, client_request_id: 'request', attachment_id: 'attachment',
      target: { kind: 'protocol_session', protocol: { session_id: 'remote', connection_generation: 1 } },
      state, phase: state === 'running' ? 'waiting' : 'finished', accepted_actions: 1,
      steps: [{ index: 0, kind: 'keyboard.key', state: 'accepted', wait_after_ms: 30000 }] }, capture_state: state === 'running' ? 'pending' : 'unavailable' } }
}

test('长轮询共享等待、终态屏障和原请求消费', async () => {
  let current = receipt(), polls = 0, wake: (() => void) | undefined
  const snapshot = (): DesktopTaskSnapshot => ({ cursor: String(current.revision).padStart(64, '0'), tasks: [{ tool_call_id: current.tool_call_id, client_request_id: 'request', generation: 1, execution_id: current.execution_id, receipt: current }] })
  const failures: Error[] = []
  const tasks = new DesktopTaskCoordinator(async (_cursor, wait, signal) => {
    polls++
    if (wait) await Promise.race([new Promise<void>(resolve => { wake = resolve }), delay(1000, undefined, { signal })])
    return snapshot()
  }, () => {}, error => { failures.push(error) })
  try {
    tasks.observe('termous.desktops.execute', desktopTaskToolResult(current))
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /still running/, '返回运行回执后立即阻止同一模型响应的后续输入')
    await tasks.reconcile()
    const waiting = tasks.wait(current.execution_id)
    await delay(20)
    assert.ok(polls <= 4, '等待不能忙轮询')
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /still running/)
    assert.equal(tasks.blocked('termous.desktops.keyboard.text', {}, { kind: 'protocol_session', session_id: 'other', connection_generation: 1 }), undefined)
    current = receipt('completed', 3); wake?.()
    assert.equal((await waiting).revision, 3)
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /decision was generated/)
    tasks.recorded(current)
    assert.equal(tasks.ready().length, 0)
    assert.ok(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' }))
    assert.deepEqual(tasks.beforeRequest([]), [], '未进入请求正文不能确认已读')
    assert.deepEqual(tasks.beforeRequest([desktopTaskMessage(current)]), [{ execution_id: current.execution_id, revision: 3 }])
    assert.equal(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' }), undefined)
    await tasks.reconcile()
    assert.equal(tasks.ready().length, 0, '重复投递不能重新注入')
    assert.equal(tasks.pending(), false)
    assert.deepEqual(failures, [])
  } finally { tasks.close() }
})

test('快链普通回执不追加自动观察，取消本地等待不伪造桌面终态', async () => {
  const current = receipt('completed', 4)
  const tasks = new DesktopTaskCoordinator(async () => ({ cursor: 'a'.repeat(64), tasks: [] }), () => {}, () => {})
  try {
    tasks.observe('termous.desktops.execute', desktopTaskToolResult(current))
    await tasks.reconcile()
    assert.equal(tasks.ready().length, 0)
    assert.deepEqual(tasks.beforeRequest(), [{ execution_id: current.execution_id, revision: 4 }])
    const abort = new AbortController()
    const waiting = tasks.waitForChange(abort.signal)
    abort.abort()
    await assert.rejects(waiting)
  } finally { tasks.close() }
})

test('显式查询终态覆盖运行中修订，迟到的观察快照不能恢复旧屏障', async () => {
  const running = receipt()
  const tasks = new DesktopTaskCoordinator(async () => ({ cursor: 'b'.repeat(64), tasks: [{ tool_call_id: running.tool_call_id, client_request_id: 'request', generation: 1, execution_id: running.execution_id, receipt: running }] }), () => {}, () => {})
  try {
    await tasks.refresh()
    tasks.observe('termous.desktops.executions.get', desktopTaskToolResult(receipt('completed', 8)))
    await tasks.reconcile()
    assert.equal(tasks.ready().length, 0)
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /decision was generated/)
    assert.deepEqual(tasks.beforeRequest(), [{ execution_id: running.execution_id, revision: 8 }])
    await tasks.reconcile()
    assert.equal(tasks.pending(), false)
  } finally { tasks.close() }
})

test('关联存在但原执行持续无法对账时有界失败，正常长等待不受影响', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const task = { tool_call_id: 'call_batch', client_request_id: 'request', generation: 1 }
  let snapshot: DesktopTaskSnapshot = { cursor: 'c'.repeat(64), tasks: [task] }
  const tasks = new DesktopTaskCoordinator(async () => snapshot, () => {}, () => {})
  try {
    await tasks.refresh()
    t.mock.timers.tick(29_999)
    await tasks.refresh()
    t.mock.timers.tick(1)
    await assert.rejects(tasks.refresh(), /AGENT_DESKTOP_TASK_UNRECONCILED/)
    snapshot = { ...snapshot, tasks: [{ ...task, execution_id: receipt().execution_id, receipt: receipt() }] }
    await tasks.refresh()
    t.mock.timers.tick(60_000)
    await tasks.refresh()
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /still running/)
  } finally { tasks.close() }
})

test('迟到的旧快照不能覆盖新任务，进行中回执始终保留等待义务', async () => {
  const reads: Array<(snapshot: DesktopTaskSnapshot) => void> = []
  const tasks = new DesktopTaskCoordinator(async (_cursor, _wait, signal) => new Promise((resolve, reject) => {
    const abort = () => reject(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    reads.push(snapshot => { signal?.removeEventListener('abort', abort); resolve(snapshot) })
  }), () => {}, () => {})
  const stale = tasks.refresh()
  try {
    const current = receipt()
    tasks.observe('termous.desktops.execute', desktopTaskToolResult(current))
    assert.equal(tasks.pending(), true, '观察响应返回前也不能提前结束 Run')
    reads[1]!({ cursor: 'b'.repeat(64), tasks: [{ tool_call_id: current.tool_call_id, client_request_id: 'request', generation: 1, execution_id: current.execution_id, receipt: current }] })
    await delay(0)
    reads[0]!({ cursor: 'a'.repeat(64), tasks: [] })
    await stale
    assert.equal(tasks.pending(), true, '旧的空快照不能清除新登记的任务')
    assert.match(tasks.blocked('termous.desktops.keyboard.text', { attachment_id: 'attachment' })!, /still running/)
  } finally { tasks.close(); await stale.catch(() => {}) }
})

test('压缩保留尚未进入模型请求的完成观察，消费后允许正常压缩', async () => {
  const first = receipt('completed', 3)
  const second = { ...first, execution_id: 'desktop_execution_second', tool_call_id: 'call_second',
    result: { ...first.result, run: { ...first.result.run, id: 'desktop_execution_second' } } }
  const completed = [first, second]
  const tasks = new DesktopTaskCoordinator(async () => ({ cursor: 'd'.repeat(64), tasks: completed.map(value => ({
    tool_call_id: value.tool_call_id, client_request_id: value.execution_id, generation: 1, execution_id: value.execution_id, receipt: value,
  })) }), () => {}, () => {})
  try {
    await tasks.refresh()
    completed.forEach(value => tasks.recorded(value))
    const raw = [{ role: 'user' as const, content: 'Earlier history', timestamp: 0 },
      ...completed.map(value => desktopTaskMessage(value)), { role: 'user' as const, content: 'Later steering '.repeat(1000), timestamp: 1 }]
    const prepare = () => prepareRuntimeCompaction(raw, undefined, { reserveTokens: 512, keepRecentTokens: 1 }, undefined, undefined, message => tasks.retainMessage(message))!
    const prepared = prepare()
    assert.deepEqual(tasks.beforeRequest(prepared.retainedTail), completed.map(value => ({ execution_id: value.execution_id, revision: value.revision })))
    assert.deepEqual(prepare().retainedTail, raw.slice(-1), '已进入请求后不再阻止常规压缩')
  } finally { tasks.close() }
})
