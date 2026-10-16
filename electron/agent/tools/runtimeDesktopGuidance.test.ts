import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { compactionTestAssistant } from '../test-support/runtimeCompactionTestFixture.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { runtimeCapabilities, capabilityTools } from './runtimeCapabilityCatalog.ts'

const acquire = 'termous.desktops.control.acquire'
const release = 'termous.desktops.control.release'
const get = 'termous.desktops.get'
const inputs = ['keyboard.shortcut', 'keyboard.key', 'keyboard.text', 'pointer.click', 'pointer.scroll'].map((name) => `termous.desktops.${name}`)
const now = Date.parse('2026-10-16T00:00:00Z')
const attachment = { id: 'attachment', session_id: 'session', connection_generation: 1, execution_generation: 2, state: 'ready',
  grant: { id: 'grant', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } }
const receipt = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  details: { kind: 'mcp', originalToolName: acquire, result: { content: [], structuredContent: data } } })

test('授权和附着查询后的下一阶段包含实际输入，普通截图不自动引入工作流', () => {
  for (const [name, data] of [[acquire, { control: { attachment } }], [get, { attachment }]] as const) {
    const navigation = runtimeToolNavigation(name, receipt(data))!
    for (const input of inputs) assert.ok(navigation.names.includes(input), input)
    assert.ok(!navigation.names.includes(acquire))
  }
  assert.deepEqual(runtimeToolNavigation('termous.desktops.capture', receipt({ capture: { screenshot_id: 'shot' } }))!.names, [])
})

test('嵌套审批终态、未取得授权和过期授权不被当作已可输入', () => {
  for (const [state, outcome] of [['pending', 'waiting'], ['rejected', 'failed'], ['expired', 'failed'], ['cancelled', 'failed']] as const) {
    const data = { control: { approval: { state }, attachment } }
    assert.equal(runtimeToolOutcome(acquire, data), outcome)
    assert.ok(!runtimeToolNavigation(acquire, receipt(data))!.names.some((name) => inputs.includes(name)))
  }
  for (const grant of [undefined, { ...attachment.grant, expires_at: '2000-01-01T00:00:00Z' }]) {
    const navigation = runtimeToolNavigation(acquire, receipt({ control: { attachment: { ...attachment, grant } } }))!
    assert.ok(!navigation.names.some((name) => inputs.includes(name)))
    assert.ok(navigation.names.includes(get))
  }
})

test('已持有与旧版占用错误都引导核验，不建议释放或自动接管', () => {
  for (const code of ['desktop_control_already_held', 'desktop_control_locked']) {
    const navigation = runtimeToolNavigation(acquire, receipt({ error: { code } }), [], true)!
    assert.deepEqual(navigation.names, [get])
    assert.match(navigation.guidance, /查询|核验/)
  }
})

test('本轮摘要保存嵌套 grant，释放与过期后不保留持有状态', () => {
  let time = now
  const progress = new RuntimeToolProgress(() => time)
  const data = { control: { attachment: { ...attachment, grant: { ...attachment.grant, idle_expires_at: new Date(now + 1000).toISOString() } } } }
  progress.observe(acquire, { attachment_id: attachment.id }, receipt(data), false)
  assert.match(progress.summary(), /"grant_id":"grant"/)
  assert.match(progress.summary(), /"grant_status":"held"/)
  time += 1001
  assert.match(progress.summary(), /"grant_status":"needs_verification"/)
  progress.observe(release, { attachment_id: attachment.id, grant_id: 'grant' }, receipt({ completed: true }), false)
  assert.match(progress.summary(), /"grant_status":"released"/)
  assert.doesNotMatch(progress.summary(), /"grant_status":"held"/)
})

test('新运行恢复历史证据但重复计数从零开始，普通重复仍不拦截', () => {
  const first = new RuntimeToolProgress(() => now)
  const result = receipt({ control: { attachment } })
  for (let i = 0; i < 3; i++) first.observe(acquire, { attachment_id: attachment.id }, result, false)
  const snapshot = first.snapshot()
  assert.equal(snapshot.version, 2)
  const next = new RuntimeToolProgress(() => now + 5000)
  assert.ok(next.restore(snapshot))
  assert.match(next.summary(), /"origin":"historical"/)
  assert.doesNotMatch(next.summary(), /"grant_status":"held"/)
  for (let i = 1; i <= 3; i++) {
    const guidance = next.observe(acquire, { attachment_id: attachment.id }, result, false)
    assert.equal(Boolean(guidance), i === 3)
    assert.equal(next.beforeCall(acquire, { attachment_id: attachment.id }), undefined)
    assert.equal(next.hidden(acquire), false)
  }
})

test('能力组入口优先，自动加载候选不改变实际能力偏好', async () => {
  const names = [...new Set(runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools))))]
  const mapped = mapMCPTools(names.map((name) => ({ name, inputSchema: { type: 'object' as const, properties: {} } })), async () => { throw new Error('不得执行候选') })
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  const found = await discovery.tool.execute('find', { group: 'desktop_input' })
  const data = JSON.parse(found.content[0]!.type === 'text' ? found.content[0].text : '{}') as { tools: { original_name: string }[] }
  assert.deepEqual(data.tools.slice(0, 4).map((tool) => tool.original_name), [acquire, inputs[0], inputs[2], inputs[3]])
  discovery.loadNames(['termous.desktop_workflows.captures.create'])
  const subsequent = await discovery.tool.execute('find-next', { operation: 'text', query: '目标应用内容' })
  assert.match(JSON.stringify(subsequent.content), /keyboard/)
})

test('只有同一附着的有效授权查询解除重复申请诊断，发现和其他附着不能代替', () => {
  const progress = new RuntimeToolProgress(() => now)
  for (let i = 0; i < 3; i++) progress.observe(acquire, { attachment_id: attachment.id }, receipt({ error: { code: 'desktop_control_locked' } }), true)
  progress.drain()
  progress.observe('discover_tools', {}, receipt({}), false)
  progress.observe(get, { attachment_id: 'other' }, receipt({ attachment: { ...attachment, id: 'other' } }), false)
  assert.equal(progress.drain().length, 0)
  progress.observe(get, { attachment_id: attachment.id }, receipt({ attachment }), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
  assert.doesNotMatch(progress.summary(), /"status":"detected"/)
})

test('历史回放只保留未解决诊断，已恢复的查询和空集合不继续提示失败', () => {
  const progress = new RuntimeToolProgress(() => now)
  progress.replay(history([
    [get, { session_id: 'other' }, { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }],
    [get, { session_id: 'session' }, { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }],
    ['termous.desktops.list', {}, { sessions: [] }],
    [get, { session_id: 'session' }, { session: { id: 'session', status: 'ready' } }],
  ]), () => true)
  assert.deepEqual(progress.snapshot().recoveries.map((entry) => entry.resource), ['session_id:other'])
  assert.equal(progress.drain().length, 0)
})

test('同一附着查询从错误恢复成功时清除按请求身份记录的诊断', () => {
  const progress = new RuntimeToolProgress(() => now)
  for (let i = 0; i < 3; i++) progress.observe(get, { attachment_id: attachment.id }, receipt({ error: { code: 'desktop_generation_stale' } }), true)
  progress.drain()
  progress.observe(get, { attachment_id: attachment.id }, receipt({ attachment }), false)
  assert.ok(progress.drain().some((notice) => notice.status === 'progressed'))
  assert.equal(progress.snapshot().recoveries.length, 0)
})

test('能力组搜索先排除受保护工具，再填充允许的候选', async () => {
  const names = [...new Set(runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools))))]
  const mapped = mapMCPTools(names.map((name) => ({ name, inputSchema: { type: 'object' as const, properties: {} } })), async () => { throw new Error('不得执行候选') })
  const allowed = 'termous.desktops.resize'
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [],
    (name) => name === allowed ? undefined : '当前状态暂不可用')
  const found = await discovery.tool.execute('find', { group: 'desktop_input' })
  const data = JSON.parse(found.content[0]!.type === 'text' ? found.content[0].text : '{}') as { tools: { original_name: string }[] }
  assert.deepEqual(data.tools.map((entry) => entry.original_name), [allowed])
})

function history(calls: [string, Record<string, string | number | boolean>, Record<string, unknown>][]): AgentMessage[] {
  return calls.flatMap(([name, args, data], index): AgentMessage[] => [
    { ...compactionTestAssistant(''), content: [{ type: 'toolCall', id: String(index), name, arguments: args }] },
    { role: 'toolResult', toolName: name, toolCallId: String(index), content: [{ type: 'text', text: JSON.stringify(data) }], isError: Boolean(data.error), timestamp: now },
  ])
}

test('历史查询仍在等待时保留失败经验，同一附着的有效查询才解除旧申请诊断', () => {
  const progress = new RuntimeToolProgress(() => now)
  progress.replay(history([
    [get, { session_id: 'pending' }, { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }],
    [get, { session_id: 'pending' }, { session: { id: 'pending', status: 'connecting' } }],
    [acquire, { attachment_id: attachment.id }, { error: { code: 'desktop_control_locked' } }],
    [get, { attachment_id: attachment.id }, { attachment }],
  ]), () => true)
  assert.deepEqual(progress.snapshot().recoveries.map((entry) => entry.resource), ['session_id:pending'])
  assert.equal(progress.drain().length, 0)
})
