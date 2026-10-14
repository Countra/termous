import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { bindWorkflowPreparation, createWorkflowWaitTool, workflowRun } from './runtimeWorkflowWait.ts'
import { runtimeDesktopSafetyOutcome } from '../execution/runtimeInputSafety.ts'

const name = 'termous.desktop_workflows.runs.get'
function report(state: string, phase = '', revision = 1) {
  const data = { report: { run: { id: 'run', state, phase, revision } } }
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: { kind: 'mcp', originalToolName: name, result: { content: [], structuredContent: data } } }
}
function getTool(execute: AgentTool['execute']): AgentTool {
  return { name, label: name, description: name, parameters: Type.Object({}), execute }
}

test('运行登记后查询异常仍保留运行标识，不暴露网络原始错误或建议重新启动', async () => {
  const get = getTool(async () => { throw new Error('https://private.example/?token=secret') })
  const start = { ...get, name: 'termous.desktop_workflows.runs.start', execute: async () => report('preparing') }
  const result = await bindWorkflowPreparation([get, start], (v) => v)[1]!.execute('start', {})
  const text = JSON.stringify(result.content)
  assert.match(text, /run_id/)
  assert.match(text, /不要重复启动/)
  assert.doesNotMatch(text, /private|secret/)
})

test('准备结束时保留完整报告，步骤不确定不能因启动结果投影而丢失', async () => {
  const get = getTool(async () => {
    const result = report('failed')
    return { ...result, details: { ...result.details, result: { content: [], structuredContent: {
      report: { run: workflowRun(result), steps: [{ state: 'uncertain' }] },
    } } } }
  })
  const start = { ...get, name: 'termous.desktop_workflows.runs.start', execute: async () => report('preparing') }
  const result = await bindWorkflowPreparation([get, start], (v) => v)[1]!.execute('start', {})
  assert.equal(runtimeDesktopSafetyOutcome(start.name, result, false).inputUncertain, true)
})

test('两分钟人工审批跨过普通 60 秒等待期限，只接受 Core 的批准或过期状态', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  for (const terminal of ['running', 'failed']) {
    const began = Date.now()
    let decided = false
    const get = getTool(async () => report(decided ? terminal : 'preparing', decided ? '' : 'waiting_approval'))
    const wait = createWorkflowWaitTool([get], (v) => v)[0]!
    let returned = false
    const result = wait.execute('call', { run_id: 'run', timeout_seconds: 1 }).then((r) => { returned = true; return r })
    await setImmediate()
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(30_000); await setImmediate(); assert.equal(returned, false) }
    assert.equal(Date.now() - began, 120_000)
    decided = true
    t.mock.timers.tick(500)
    assert.equal(workflowRun(await result)?.state, terminal)
  }
})

test('内置启动只派发一次，准备和人工确认结束前不交回模型；保持启动结果合同', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let starts = 0
  let phase = 'waiting_user_action'
  const get = getTool(async () => report(phase ? 'preparing' : 'running', phase))
  const start = { ...get, name: 'termous.desktop_workflows.runs.start', execute: async () => {
    starts++
    const result = report('preparing')
    return { ...result, details: { ...result.details, result: { content: [], structuredContent: { run: workflowRun(result) } } } }
  } }
  let returned = false
  const tools = bindWorkflowPreparation([get, start], (v) => v)
  const result = tools[1]!.execute('start', {}).then((r) => { returned = true; return r })
  await setImmediate()
  t.mock.timers.tick(10_000); await setImmediate()
  assert.equal(returned, false)
  phase = 'waiting_approval'
  t.mock.timers.tick(120_000); await setImmediate()
  assert.equal(returned, false)
  phase = ''
  t.mock.timers.tick(500)
  assert.equal(workflowRun(await result)?.state, 'running')
  assert.equal(starts, 1)
})

test('人工等待中可立即取消，不再发送报告请求', async () => {
  const abort = new AbortController()
  let calls = 0
  const get = getTool(async () => { calls++; return report('preparing', 'waiting_approval') })
  const result = createWorkflowWaitTool([get], (v) => v)[0]!.execute('call', { run_id: 'run' }, abort.signal)
  await setImmediate()
  abort.abort(new Error('用户停止'))
  await assert.rejects(result, /用户停止/)
  assert.equal(calls, 1)
})
