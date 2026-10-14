import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import type { AgentTool, AgentMessage } from '@earendil-works/pi-agent-core'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { RuntimeContextImages } from './runtimeContextImages.ts'
import { RuntimeImageWorkingSet, pendingPreviewCall } from './runtimeImageWorkingSet.ts'
import { prepareRuntimeCompaction } from './runtimeCompactionPreparation.ts'
import { encodeMCPToolName } from './toolNameCodec.ts'
import { createWorkflowWaitTool } from './runtimeWorkflowWait.ts'

const tool = (name: string): AgentTool => ({ name, label: name, description: `测试能力 ${name}`, parameters: Type.Object({ id: Type.String() }), execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }) })

test('134 个工具不进入初始声明；按轮发布、精确加载和 LRU 上限不扩权', async () => {
  const names = Array.from({ length: 134 }, (_, i) => `termous.fixture.tool${i}`)
  const tools = names.map(tool)
  const discovery = new RuntimeToolDiscovery(tools, (name) => name, [tool('read_skill_resource'), tool('read_history_image')])
  assert.equal(discovery.active().length, 3)
  const full = JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).length
  const initial = JSON.stringify(discovery.active().map(({ name, description, parameters }) => ({ name, description, parameters }))).length
  assert.ok(initial < full * .3, `${initial}/${full}`)
  for (let start = 0; start < 120; start += 8) {
    await discovery.tool.execute(`call${start}`, { query: '精确工具', names: names.slice(start, start + 8) })
    assert.equal(discovery.active().some((tool) => tool.name === names[start]), false)
    const active = discovery.publish()
    assert.ok(active.length <= 32)
    assert.ok(active.some((tool) => tool.name === names[start]))
  }
  await discovery.tool.execute('unknown', { query: '不能授予能力', names: ['termous.secrets.read'] })
  assert.ok(!discovery.publish().some((tool) => tool.name === 'termous.secrets.read'))
  const batched = new RuntimeToolDiscovery(tools, (name) => name, [tool('read_skill_resource'), tool('read_history_image')])
  for (let start = 0; start < 64; start += 8) await batched.tool.execute(`batch${start}`, { query: '工具', names: names.slice(start, start + 8) })
  assert.ok(batched.publish().length <= 32)
})

test('中文意图可发现输入工具；资源控制与清理入口不会因其他领域加载被卸载', async () => {
  const names = ['termous.desktops.pointer.click', 'termous.desktops.keyboard.text', 'termous.desktops.control.release', 'termous.desktops.detach']
  const discovery = new RuntimeToolDiscovery(names.map(tool), (name) => name, [])
  await discovery.tool.execute('find', { query: '帮我点击远程桌面并输入文字' })
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('pointer.click')))
  discovery.touch(names[0]!)
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('control.release')))
})

test('桌面图片只保留两个观察组及待确认预览，持久化原消息不变', () => {
  const images = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  const messages: AgentMessage[] = []
  for (let i = 0; i < 5; i++) {
    const message: AgentMessage = { role: 'toolResult', toolCallId: `call${i}`, toolName: encodeMCPToolName(i === 0 ? 'termous.desktop_workflows.templates.preview' : 'termous.desktops.capture'), content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(`image${i}`).toString('base64') }], isError: false, timestamp: i }
    if (i === 0) message.content.push({ type: 'text', text: JSON.stringify({ preview: { preview_id: 'preview', expires_at: '2099-01-01T00:00:00Z' } }) })
    images.registerToolResult(`part${i}`, message)
    messages.push(message)
  }
  const working = new RuntimeImageWorkingSet(images)
  const projected = working.project(messages)
  const count = (items: AgentMessage[]) => items.reduce((sum, item) => sum + (item.role === 'toolResult' ? item.content.filter((part) => part.type === 'image').length : 0), 0)
  assert.equal(count(projected.messages), 3)
  assert.equal(count(messages), 5)
  assert.match(JSON.stringify(projected.messages[1]), /history_image.*当前看不到像素/u)
  assert.equal(working.project(messages).changed, false)
  const confirmCall: AgentMessage = { role: 'assistant', content: [{ type: 'toolCall', id: 'confirmed', name: encodeMCPToolName('termous.desktop_workflows.templates.confirm'), arguments: { preview_id: 'other' } }], api: 'openai-completions', provider: 'test', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 6 }
  messages.push(confirmCall, { role: 'toolResult', toolCallId: 'confirmed', toolName: encodeMCPToolName('termous.desktop_workflows.templates.confirm'), content: [{ type: 'text', text: 'confirmed' }], isError: false, timestamp: 6 })
  assert.equal(count(working.project(messages).messages), 3)
  const call = confirmCall.content[0]!
  if (call.type === 'toolCall') call.arguments = { preview_id: 'preview' }
  assert.equal(count(working.project(messages).messages), 2)
})

test('上下文压缩保留尚待确认预览的完整调用组，已确认后允许继续压缩', () => {
  const assistant = (id: string): AgentMessage => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: encodeMCPToolName('termous.desktop_workflows.templates.preview'), arguments: {} }], api: 'openai-completions', provider: 'test', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 1 })
  const messages: AgentMessage[] = [{ role: 'user', content: '旧历史'.repeat(1000), timestamp: 0 }, assistant('preview'), { role: 'toolResult', toolCallId: 'preview', toolName: encodeMCPToolName('termous.desktop_workflows.templates.preview'), content: [{ type: 'image', data: 'aQ==', mimeType: 'image/png' }, { type: 'text', text: '{"preview":{"preview_id":"one","expires_at":"2099-01-01T00:00:00Z"}}' }], isError: false, timestamp: 1 }, { role: 'user', content: '接下来的消息'.repeat(1000), timestamp: 2 }]
  const result = prepareRuntimeCompaction(messages, undefined, { keepRecentTokens: 20, reserveTokens: 20 }, undefined, pendingPreviewCall)!
  assert.equal(result.retainedTail[0], messages[1])
  assert.ok(result.messagesToSummarize.length + result.turnPrefixMessages.length > 0)
  assert.equal(pendingPreviewCall(messages, Date.parse('2100-01-01T00:00:00Z')), undefined)
})

test('运行等待读取实际 report.run.state，状态轮询不返回模型', async () => {
  let calls = 0
  const get = tool('get')
  get.execute = async () => {
    calls++
    return { content: [{ type: 'text', text: 'report' }], details: { kind: 'mcp', originalToolName: 'termous.desktop_workflows.runs.get', result: { content: [], structuredContent: { report: { run: { state: calls === 1 ? 'running' : 'completed', phase: '', revision: calls } } } } } }
  }
  const wait = createWorkflowWaitTool([get], () => 'termous.desktop_workflows.runs.get')[0]!
  let updates = 0
  await wait.execute('wait', { run_id: 'run' }, undefined, () => { updates++ })
  assert.equal(calls, 2)
  assert.equal(updates, 1)
})
