import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// 仅向已经人工观察并确认的空白测试编辑器输入；启动与最终画面核对由实机验收负责。
const [x, y] = process.argv.slice(2).map(Number)
if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new Error('需要提供已观察的测试编辑区坐标 x y')
const output = fileURLToPath(new URL('../../../TEMP/desktop-batch-live/', import.meta.url))
const queue = path.join(output, 'commands.json')
const prefix = `check-${Date.now()}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let serial = 0

async function enqueue(tool, args = {}, options = {}) {
  const id = `${prefix}-${++serial}`
  const commands = JSON.parse(await readFile(queue, 'utf8'))
  commands.push({ id, tool, args, ...options })
  // 同目录替换由单个验收进程写入，驱动只读取；报告文件始终以唯一标识区分。
  await writeFile(queue + '.next', JSON.stringify(commands), 'utf8')
  for (let attempt = 0; ; attempt++) {
    try { await rename(queue + '.next', queue); break } catch (error) {
      // Windows 读句柄可能短暂阻止替换；只重试发布同一份队列，不生成新请求。
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) throw error
      await delay(25)
    }
  }
  return id
}

async function result(id) {
  for (const deadline = Date.now() + 180000; Date.now() < deadline;) {
    for (const suffix of ['.json', '.error.json']) {
      try {
        const value = JSON.parse(await readFile(path.join(output, id + suffix), 'utf8'))
        if (suffix === '.error.json') throw new Error(value.error)
        return value
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    await delay(25)
  }
  throw new Error(`测试回执超时: ${id}`)
}

async function call(tool, args = {}, options = {}) { return result(await enqueue(tool, args, options)) }
const select = () => call('keyboard.shortcut', { codes: ['ControlLeft', 'KeyA'] })
const samples = []

for (const mode of ['single', 'batch']) {
  for (let index = 1; index <= 5; index++) {
    await call('capture')
    const text = `Termous RDP ${mode} 验收 ${index}`
    let elapsed = 0, evidence
    if (mode === 'batch') {
      evidence = await call('execute', { actions: [
        { kind: 'pointer.click', x, y },
        { kind: 'keyboard.shortcut', codes: ['ControlLeft', 'KeyA'] },
        { kind: 'keyboard.text', text, wait_after_ms: 1000 },
      ] })
      assert.equal(evidence.result.run.state, 'completed')
      assert.equal(evidence.result.run.accepted_actions, 3)
      assert.deepEqual(evidence.result.run.steps.map(step => step.wait_after_ms), [500, 500, 1000])
      elapsed = evidence.elapsed_ms
    } else {
      // 单动作与批次使用相同等待策略；排除文件队列轮询时间，统计工具耗时加约定等待。
      for (const [tool, args, wait] of [
        ['pointer.click', { x, y }, 500],
        ['keyboard.shortcut', { codes: ['ControlLeft', 'KeyA'] }, 500],
        ['keyboard.text', { text }, 1000],
        ['capture', {}, 0],
      ]) {
        evidence = await call(tool, args)
        elapsed += evidence.elapsed_ms + wait
        if (wait) await delay(wait)
      }
    }
    assert.ok(evidence.images.length > 0)
    // 独立验收观察不计入执行段耗时；不得把迟到帧替换成批次原截图。
    await delay(750)
    const verification = await call('capture')
    samples.push({ mode, index, elapsed_ms: elapsed, calls: mode === 'batch' ? 1 : 4, expected_text: text, images: evidence.images, result: evidence.result, verification })
  }
}

// 实际跨过原生租约的三十秒期限，确认等待期间续租且后续输入没有提前超时。
const longWaitStart = Date.now()
const initialWait = await call('execute', { wait_ms: 5000, actions: [
  { kind: 'keyboard.shortcut', codes: ['ControlLeft', 'KeyA'], wait_after_ms: 35000 },
  { kind: 'keyboard.text', text: 'Termous RDP long wait verified' },
] })
assert.equal(initialWait.result.run.state, 'running')
assert.ok(initialWait.elapsed_ms >= 4500 && initialWait.elapsed_ms < 10000)
const independentStart = Date.now()
assert.ok((await readFile(new URL('../../../backend/docs/desktop-batch-acceptance.md', import.meta.url), 'utf8')).length > 0)
const independentReadMS = Date.now() - independentStart
const asyncBlocked = await call('keyboard.text', { text: 'MUST_NOT_INTERLEAVE' }, { expected_error: true })
assert.equal(asyncBlocked.tool_error, true)
let longWait = initialWait
while (longWait.result.run.state === 'running') longWait = await call('executions.get', {
  execution_id: longWait.result.run.id, after_revision: longWait.result.run.revision, wait_ms: 10000,
}, { expected_error: true })
assert.equal(longWait.result.run.state, 'completed')
assert.equal(longWait.result.run.accepted_actions, 2)
assert.deepEqual(longWait.result.run.steps.map(step => step.wait_after_ms), [35000, 500])
assert.ok(Date.now() - longWaitStart >= 35500)
await delay(750)
const longWaitEvidence = await call('capture')

const invalidActions = [
  { kind: 'keyboard.key', code: 'InvalidKeyCode' },
  { kind: 'keyboard.shortcut', codes: ['ControlLeft', 'ControlLeft'] },
  { kind: 'keyboard.text', text: 'invalid\u0000text' },
]
const preflight = []
for (const action of invalidActions) {
  const receipt = await call('execute', { actions: [{ kind: 'keyboard.text', text: 'MUST_NOT_APPEAR' }, action] }, { expected_error: true })
  assert.equal(receipt.tool_error, true)
  assert.equal(receipt.result.run.accepted_actions, 0)
  assert.equal(receipt.result.run.state, 'stopped')
  preflight.push(receipt)
}

await select()
const onceArgs = { client_request_id: `${prefix}-once`, interval_ms: 200, actions: [{ kind: 'keyboard.text', text: 'Termous RDP exactly once', wait_after_ms: 0 }] }
const once = await call('execute', onceArgs)
const duplicate = await call('execute', onceArgs)
const history = await call('executions.get', { client_request_id: onceArgs.client_request_id })
assert.equal(once.result.run.steps[0].wait_after_ms, 0)
assert.equal(duplicate.result.run.id, once.result.run.id)
assert.equal(history.result.capture.screenshot_id, once.result.capture.screenshot_id)
assert.equal(duplicate.result.capture.screenshot_id, once.result.capture.screenshot_id)
const conflict = await call('execute', { ...onceArgs, interval_ms: 201 }, { expected_error: true })
assert.equal(conflict.tool_error, true)
const dedupEvidence = await call('capture')

async function interrupt(revoke) {
  await select()
  const request = `${prefix}-${revoke ? 'revoke' : 'cancel'}`
  const initial = await call('execute', { client_request_id: request, wait_ms: 5000, actions: [
    { kind: 'keyboard.text', text: `Termous RDP ${revoke ? 'revoked' : 'cancelled'} safely`, wait_after_ms: 90000 },
    { kind: 'keyboard.text', text: 'MUST_NOT_APPEAR' },
  ] }, { expected_error: true })
  assert.equal(initial.result.run.state, 'running')
  let ready = false
  for (const deadline = Date.now() + 1500; Date.now() < deadline;) {
    const current = await call('executions.get', { client_request_id: request }, { expected_error: true })
    if (current.result?.run?.accepted_actions === 1) { ready = true; break }
    await delay(20)
  }
  assert.ok(ready, '未观察到首步已接受的等待阶段')
  const blocked = await call('keyboard.text', { text: 'MUST_NOT_INTERLEAVE' }, { expected_error: true })
  assert.equal(blocked.tool_error, true)
  if (revoke) await call('control.release')
  else await call('executions.cancel', { client_request_id: request }, { expected_error: true })
  let receipt = initial
  while (receipt.result.run.state === 'running') receipt = await call('executions.get', {
    execution_id: receipt.result.run.id, after_revision: receipt.result.run.revision, wait_ms: 10000,
  }, { expected_error: true })
  assert.equal(receipt.result.run.state, 'cancelled')
  assert.equal(receipt.result.run.accepted_actions, 1)
  assert.equal(receipt.result.run.steps[1].state, 'skipped')
  const repeated = await call('executions.cancel', { client_request_id: request }, { expected_error: true })
  assert.equal(repeated.result.run.id, receipt.result.run.id)
  assert.equal(repeated.result.run.state, 'cancelled')
  await delay(500)
  return { receipt, evidence: await call('capture') }
}

const cancellation = await interrupt(false)
const revocation = await interrupt(true)
await call('control.acquire')
const report = { prefix, target: 'win-4090', assertions_passed: true, visual_verification: 'pending', samples, preflight,
  long_wait: { initial: initialWait, receipt: longWait, evidence: longWaitEvidence, independent_read_ms: independentReadMS },
  deduplication: { once, duplicate, history, conflict, evidence: dedupEvidence }, cancellation, revocation }
await writeFile(path.join(output, 'rdp-result.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ report: path.join(output, 'rdp-result.json'), assertions_passed: true, visual_verification: 'pending' }))
