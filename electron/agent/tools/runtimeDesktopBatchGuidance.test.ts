import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'

function result(name: string, data: Record<string, unknown>, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {
    kind: 'mcp', originalToolName: name, result: { content: [], structuredContent: data, isError },
  } }
}
const execution = (kind = 'none', dispatch = 'dispatched') => ({ phase: 'desktop_input', dispatch, recovery: { kind } })
const input = 'termous.desktops.keyboard.shortcut'

test('已接受输入的 none 走正常导航，失败或未知派发仍保留恢复语义', () => {
  const accepted = { operation: { state: 'accepted', execution: execution() } }
  assert.equal(runtimeToolOutcome(input, accepted), 'settled')
  const success = runtimeToolNavigation(input, result(input, accepted))!
  assert.ok(!success.recovery)
  assert.ok(success.names.includes('termous.desktops.execute'))
  assert.ok(!success.names.includes('termous.desktops.operations.get'))
  assert.doesNotMatch(success.guidance, /No automatic recovery/)
  for (const [state, dispatch, error] of [['failed', 'not_started', true], ['accepted', 'dispatched', true], ['uncertain', 'unknown', false], ['accepted', 'unknown', false]] as const) {
    const navigation = runtimeToolNavigation(input, result(input, { operation: { state, execution: execution('none', dispatch) } }, error))!
    assert.equal(navigation.recovery, true)
    assert.deepEqual(navigation.names, [])
    assert.match(navigation.guidance, /No automatic recovery/)
    if (dispatch === 'unknown') assert.match(navigation.guidance, /uncertain/)
  }
})

function batch(state: string, kind: string) {
  return { run: { id: 'desktop_execution_test', state, accepted_actions: state === 'completed' ? 1 : 0,
    steps: [{ index: 0, kind: 'keyboard.text', state: state === 'completed' ? 'accepted' : state === 'running' ? 'dispatching' : 'skipped', wait_after_ms: 500 }],
    execution: { phase: 'desktop_batch', dispatch: state === 'running' ? 'unknown' : 'dispatched',
      recovery: { kind, ...(kind === 'none' ? {} : { tool: 'termous.desktops.executions.get', arguments: { execution_id: 'desktop_execution_test' } }) } } },
  capture_state: state === 'running' ? 'pending' : 'ready' }
}

test('后台回执提供等待与原查询，完成与截断说明保留原截图且不要求重拍', () => {
  const name = 'termous.desktops.execute'
  const running = runtimeToolNavigation(name, result(name, batch('running', 'wait')))!
  assert.deepEqual(running.names, ['wait_desktop_execution', 'termous.desktops.executions.get'])
  assert.equal(running.prerequisite, undefined)
  assert.match(running.guidance, /independent work/)
  for (const state of ['completed', 'stopped', 'cancelled']) {
    const navigation = runtimeToolNavigation(name, result(name, batch(state, state === 'completed' ? 'none' : 'reread'), state !== 'completed'))!
    assert.deepEqual(navigation.names, [])
    assert.equal(navigation.prerequisite, undefined)
    assert.match(navigation.guidance, /screenshot/)
    if (state === 'completed') assert.match(navigation.guidance, /No recovery is needed/)
    else assert.match(navigation.guidance, /Accepted actions were not undone/)
  }
})

test('清理与输入不确定优先于成功 none，审批仍按原恢复处理', () => {
  const name = 'termous.desktops.execute'
  const completed = batch('completed', 'none')
  const cleanup = { ...completed, run: { ...completed.run, cleanup_error: 'desktop_cleanup_uncertain' } }
  assert.match(runtimeToolNavigation(name, result(name, cleanup))!.guidance, /清理尚未确认/)
  const uncertain = { ...completed, run: { ...completed.run, state: 'uncertain', accepted_actions: 0,
    steps: [{ ...completed.run.steps[0]!, state: 'uncertain' }], execution: execution('user_action', 'unknown') } }
  assert.match(runtimeToolNavigation(name, result(name, uncertain))!.guidance, /User intervention/)
  const approval = { error: { code: 'MCP_APPROVAL_REQUIRED', execution: execution('approval', 'not_started') } }
  assert.match(runtimeToolNavigation(input, result(input, approval, true))!.guidance, /existing approval/)
})

test('截图和 Skill 声明补齐链式入口，装载不调用工具且不补齐未授权能力', () => {
  let calls = 0
  const names = ['capture', 'execute', 'pointer.click', 'pointer.scroll', 'keyboard.text', 'keyboard.shortcut'].map(name => `termous.desktops.${name}`)
  const mapped = mapMCPTools(names.map(name => ({ name, inputSchema: { type: 'object' as const, properties: {} } })), async () => { calls++; return { content: [] } })
  const discovery = new RuntimeToolDiscovery(mapped.tools, name => mapped.originalNames.get(name) ?? null, [], name => name.endsWith('keyboard.text') ? 'revoked' : undefined)
  const target = { kind: 'protocol_session' as const, session_id: 'original', connection_generation: 1 }
  const loaded = discovery.preload([], target).map(tool => mapped.originalNames.get(tool.name) ?? tool.name)
  for (const name of ['capture', 'execute', 'pointer.click', 'keyboard.shortcut']) assert.ok(loaded.includes(`termous.desktops.${name}`))
  assert.ok(!loaded.includes('termous.desktops.keyboard.text'))
  const navigation = runtimeToolNavigation('termous.desktops.capture', result('termous.desktops.capture', { capture: { screenshot_id: 'current' } }))!
  const hint = JSON.parse(discovery.navigate(navigation)).tool_navigation
  assert.ok(hint.available_next_turn.some((entry: { original_name: string }) => entry.original_name === 'termous.desktops.execute'))
  assert.ok(hint.unavailable.some((entry: { name: string }) => entry.name === 'termous.desktops.keyboard.text'))
  assert.ok(discovery.loadReferencedTools('', 'skill://termous-remote-desktop/SKILL.md').some(entry => entry.original_name === 'termous.desktops.execute'))
  assert.equal(calls, 0)
})
