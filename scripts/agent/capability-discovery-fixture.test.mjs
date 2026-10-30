import assert from 'node:assert/strict'
import test from 'node:test'
import { discoveryCases, discoveryFixture } from './capability-discovery-fixture.mjs'
import { projectDiscoveryRequest, summarizeDiscovery } from './capability-discovery-acceptance.mjs'
import { toolIdentity } from '../../electron/agent/contracts/toolSources.ts'

test('明确动作任务都指向存在的独立业务工具，保留本地来源且不连接真实资源', async () => {
  const exact = discoveryCases.filter(item => item.evaluation === 'exact_action')
  assert.ok(exact.length > 0)
  assert.equal(new Set(exact.map((item) => item.expected)).size, exact.length)
  for (const item of exact) {
    const calls = []
    const fixture = discoveryFixture(item.id, (call) => calls.push(call))
    const tool = fixture.mcp.tools.find((tool) => fixture.mcp.originalName(tool.name) === item.expected)
    assert.ok(tool, item.expected)
    assert.equal(toolIdentity(tool).source.id, item.expected.startsWith('termous.local.') ? 'local' : 'termous')
    await tool.execute('test', {})
    assert.equal(calls.length, 1)
    assert.equal(fixture.success(), true)
  }
})

test('开放目标接入相同模型夹具，单步与链式成功分开于严格单次指标', async () => {
  for (const batch of [false, true]) {
    const calls = []
    const fixture = discoveryFixture('catalog_open_click', call => calls.push(call))
    const name = batch ? 'termous.desktops.execute' : 'termous.desktops.pointer.click'
    const action = { x: 20, y: 30 }
    const args = batch ? { screenshot_id: 'fixture-shot', actions: [{ kind: 'pointer.click', ...action }] }
      : { screenshot_id: 'fixture-shot', ...action }
    await fixture.mcp.tools.find(tool => fixture.mcp.originalName(tool.name) === name).execute('test', args)
    assert.equal(fixture.success(), true)
    const summary = summarizeDiscovery([{ variant: 'current', evaluation: 'open_goal', success: fixture.success(), calls, discoveries: [], requests: [] }])[0]
    assert.equal(summary.open_goal_successes, 1)
    assert.equal(summary.strict_single_action_successes, 0)
    assert.equal(summary.unexpected_business_calls, 0)
  }
})

test('索引消融覆盖两种 Provider 系统消息格式，不修改用户正文', () => {
  const content = 'base rules\n\nAvailable capability index (147 tools)\nindex'
  for (const body of [
    { instructions: content },
    { messages: [{ role: 'system', content }] },
    { messages: [{ role: 'developer', content }] },
    { input: [{ role: 'developer', content: [{ type: 'input_text', text: content }] }] },
  ]) {
    assert.equal(projectDiscoveryRequest(structuredClone(body), 'current').index_visible, true)
    assert.equal(projectDiscoveryRequest(body, 'without_index').index_visible, false)
    assert.ok(JSON.stringify(body).includes('base rules'))
  }
  const body = { messages: [{ role: 'user', content: '保留用户原文' }] }
  projectDiscoveryRequest(body, 'without_index')
  assert.equal(body.messages[0].content, '保留用户原文')
})

test('选择统计保留严格失败，最终选对不能冒充一次成功或真实动作成功', () => {
  const common = { variant: 'current', expected_tool: 'click', discoveries: [], requests: [], total_tokens: 1, duration_ms: 2 }
  const result = summarizeDiscovery([
    { ...common, success: true, calls: [{ name: 'click', input: true }] },
    { ...common, success: false, calls: [{ name: 'capture', input: false }, { name: 'click', input: true }] },
    { ...common, success: false, calls: [{ name: 'keys', input: false }, { name: 'keys', input: false }], nonprogress_calls: 1 },
    { ...common, calls: [] },
  ])[0]
  assert.equal(result.samples, 3)
  assert.equal(result.strict_single_action_successes, 1)
  assert.equal(result.first_business_tool_correct, 1)
  assert.equal(result.eventual_correct_selection, 2)
  assert.equal(result.unexpected_business_calls, 3)
  assert.equal(result.repeated_business_calls, 1)
})
