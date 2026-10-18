import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeInputSafety } from './runtimeInputSafety.ts'

const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} })

test('释放清理未确认不误报输入已派发，旧 Core 错误仍兼容', () => {
  for (const code of ['desktop_cleanup_uncertain', 'desktop_input_uncertain']) {
    const safety = new RuntimeInputSafety()
    safety.observe('termous.desktops.control.release', result({ error: { code } }), true)
    assert.equal(safety.failure(), undefined)
    for (const name of ['termous.desktops.pointer.click', 'termous.desktops.control.acquire', 'termous.desktops.control.release', 'termous.desktops.attach', 'termous.desktop_workflows.runs.start']) {
      assert.match(safety.blockedTool(name, {})!, /清理尚未确认/u)
    }
    for (const name of ['termous.desktops.get', 'termous.desktops.capture', 'termous.desktops.operations.get', 'wait_workflow_run', 'discover_tools', 'termous.desktop_workflows.update']) {
      assert.equal(safety.blockedTool(name, {}), undefined)
    }
    assert.equal(safety.blockedTool('termous.desktop_workflows.runs.control', { action: 'cancel' }), undefined)
    assert.ok(safety.blockedTool('termous.desktop_workflows.runs.control', { action: 'resume' }))
  }
})

test('工作流清理未确认与步骤不确定分别判断，普通失效不会触发输入不确定', () => {
  for (const name of ['termous.desktop_workflows.runs.get', 'wait_workflow_run']) {
    for (const state of ['interrupted', 'uncertain']) {
      const safety = new RuntimeInputSafety()
      safety.observe(name, result({ report: { run: { state, error_code: state === 'interrupted' ? 'desktop_control_stale' : '', cleanup_error: 'desktop_cleanup_uncertain' }, steps: [{ state: 'accepted' }] } }), false)
      assert.equal(safety.failure(), undefined)
      assert.ok(safety.blockedTool('termous.desktop_workflows.runs.start', {}))
      safety.observe(name, result({ report: { run: { state, cleanup_error: 'desktop_cleanup_uncertain' }, steps: [{ state: 'uncertain' }] } }), false)
      assert.equal(safety.failure()?.code, 'AGENT_RUNTIME_INPUT_UNCERTAIN')
    }
  }
  const safety = new RuntimeInputSafety()
  safety.observe('termous.desktops.keyboard.text', result({ error: { code: 'desktop_control_stale' } }), true)
  assert.equal(safety.failure(), undefined)
})

test('已派发输入及无法判明阶段的工作流不确定仍停止，任意正文同名字段不触发', () => {
  for (const [name, data] of [
    ['termous.desktops.pointer.click', { error: { code: 'desktop_input_uncertain' } }],
    ['termous.desktops.operations.get', { operation: { state: 'uncertain' } }],
    ['termous.desktop_workflows.runs.get', { report: { run: { state: 'uncertain' } } }],
  ] as const) {
    const safety = new RuntimeInputSafety()
    safety.observe(name, result(data), true)
    assert.equal(safety.failure()?.code, 'AGENT_RUNTIME_INPUT_UNCERTAIN')
  }
  const unrelated = new RuntimeInputSafety()
  unrelated.observe('termous.files.read', result({ operation: { state: 'uncertain' } }), true)
  assert.equal(unrelated.failure(), undefined)
})

test('审批后清理冲突沿用既有保护，普通占用及未执行审批不会误触发', () => {
  for (const code of ['desktop_cleanup_uncertain', 'desktop_input_uncertain']) {
    const safety = new RuntimeInputSafety()
    safety.observe('termous.desktops.control.acquire', result({ control: { approval: { state: 'dispatch_conflict', error_code: code } } }), false)
    assert.equal(safety.failure(), undefined)
    assert.ok(safety.blockedTool('termous.desktops.keyboard.text', {}))
    assert.ok(safety.blockedTool('termous.desktops.control.acquire', {}))
    assert.equal(safety.blockedTool('termous.desktops.get', {}), undefined)
  }
  for (const [state, code] of [['pending', 'desktop_cleanup_uncertain'], ['rejected', 'desktop_cleanup_uncertain'], ['dispatch_conflict', 'desktop_control_locked']]) {
    const safety = new RuntimeInputSafety()
    safety.observe('termous.desktops.control.acquire', result({ control: { approval: { state, error_code: code } } }), false)
    assert.equal(safety.failure(), undefined)
    assert.equal(safety.blockedTool('termous.desktops.keyboard.text', {}), undefined)
  }
})
