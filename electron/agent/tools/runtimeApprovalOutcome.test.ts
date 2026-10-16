import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeToolFailureCode, runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'

const name = 'termous.desktops.control.acquire'
const receipt = (data: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  details: { kind: 'mcp', originalToolName: name, result: { content: [], structuredContent: data, isError: false } } })

test('真实的审批后执行冲突保留领域错误码，并立即采用占用恢复导航', () => {
  for (const code of ['desktop_control_locked', 'desktop_control_already_held']) {
    const data = { control: { approval: { state: 'dispatch_conflict', error_code: code },
      attachment: { id: 'a', state: 'ready', grant: { id: 'g', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } } } }
    assert.equal(runtimeToolFailureCode(name, data), code)
    assert.equal(runtimeToolOutcome(name, data), 'failed')
    const navigation = runtimeToolNavigation(name, receipt(data))!
    assert.equal(navigation.recovery, true)
    assert.deepEqual(navigation.names, ['termous.desktops.get'])
    assert.match(navigation.guidance, /查询当前 attachment_id/)
  }
})

test('审批执行中是等待，审批终态和缺失错误码采用稳定分类', () => {
  assert.equal(runtimeToolOutcome(name, { control: { approval: { state: 'dispatching' } } }), 'waiting')
  assert.equal(runtimeToolFailureCode(name, { control: { approval: { state: 'dispatch_conflict' } } }), 'approval_dispatch_conflict')
  for (const state of ['rejected', 'expired', 'cancelled']) {
    assert.equal(runtimeToolFailureCode(name, { control: { approval: { state, error_code: 'desktop_control_locked' } } }), `approval_${state}`)
  }
})

test('通用审批与工作流报告使用同一冲突语义，不从远端正文提取审批错误', () => {
  const approval = { state: 'dispatch_conflict', error_code: 'fixture_conflict' }
  for (const [tool, data] of [
    ['termous.commands.dispatch', { approval }],
    ['termous.desktop_workflows.runs.get', { report: { approval } }],
  ] as const) assert.equal(runtimeToolFailureCode(tool, data), 'fixture_conflict')
  assert.equal(runtimeToolFailureCode('termous.commands.get', { output: { approval }, text: JSON.stringify(approval) }), undefined)
})
