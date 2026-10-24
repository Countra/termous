import assert from 'node:assert/strict'
import test from 'node:test'
import { discoveryCases, discoveryFixture } from './capability-discovery-fixture.mjs'
import { projectDiscoveryRequest, summarizeDiscovery } from './capability-discovery-acceptance.mjs'

test('20 类选择任务都指向存在的独立业务工具，不连接真实资源', async () => {
  assert.equal(discoveryCases.length, 20)
  assert.equal(new Set(discoveryCases.map((item) => item.expected)).size, 20)
  for (const item of discoveryCases) {
    const calls = []
    const fixture = discoveryFixture(item.id, (call) => calls.push(call))
    const tool = fixture.mcp.tools.find((tool) => fixture.mcp.originalName(tool.name) === item.expected)
    assert.ok(tool, item.expected)
    await tool.execute('test', {})
    assert.equal(calls.length, 1)
    assert.equal(fixture.success(), true)
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
    { ...common, success: true, calls: [{ name: 'click' }] },
    { ...common, success: false, calls: [{ name: 'capture' }, { name: 'click' }] },
    { ...common, success: false, calls: [{ name: 'keys' }, { name: 'keys' }], nonprogress_calls: 1 },
    { ...common, calls: [] },
  ])[0]
  assert.equal(result.samples, 3)
  assert.equal(result.strict_single_action_successes, 1)
  assert.equal(result.first_business_tool_correct, 1)
  assert.equal(result.eventual_correct_selection, 2)
  assert.equal(result.unexpected_business_calls, 3)
  assert.equal(result.repeated_business_calls, 1)
})
