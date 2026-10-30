import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { RuntimeToolRegistry } from './runtimeToolRegistry.ts'
import { capabilitySelectionGuidance } from './guidance/selection.ts'
import { describeCapabilityTool } from './guidance/description.ts'
import { createToolSearch } from './runtimeToolSearch.ts'
import { capabilityToolName, runtimeCapabilities, runtimeCapability, skillEntryTools } from './runtimeCapabilityCatalog.ts'
import { identifyTool, externalToolSource, localToolSource, termousToolSource } from '../contracts/toolSources.ts'
import { withToolDescription } from '../contracts/toolDescriptions.ts'
import { initialTools } from './discovery/initialTools.ts'
import type { ToolCapability } from '../contracts/toolCapabilities.ts'

const tool = (name: string) => identifyTool({ name, label: name, description: '基础说明', parameters: Type.Object({}),
  execute: async () => ({ content: [], details: {} }) }, name.startsWith('termous.local.') ? localToolSource : termousToolSource)

test('说明投影与目录重建幂等，受管模式不重新加入手动授权参数', () => {
  const name = 'termous.desktops.pointer.click'
  const managed = withToolDescription(tool(name), '运行时准备参数', 'managed')
  const first = new RuntimeToolRegistry([managed], value => value)
  const second = new RuntimeToolRegistry(first.entries.map(entry => entry.tool), value => value)
  assert.equal(second.entries[0].tool.description, first.entries[0].tool.description)
  assert.equal(second.fingerprint, first.fingerprint)
  assert.doesNotMatch(second.entries[0].tool.description, /Use this attachment's valid grant_id/)
  assert.equal(second.entries[0].capability?.selection?.use_when, runtimeCapability(name)?.selection?.use_when)
})

test('只有可信 Core 能提供说明分段，伪装元数据不能改变外部描述', () => {
  const name = 'termous.commands.dispatch'
  const definition = { name, description: '完整传输说明', inputSchema: { type: 'object' as const },
    _meta: { 'termous/capability': { version: 1, base_description: '原始参数说明' } } }
  for (const source of [termousToolSource, externalToolSource('outside')]) {
    const mapped = mapMCPTools([definition], async () => ({ content: [] }), source)
    const registry = new RuntimeToolRegistry(mapped.tools, value => mapped.originalNames.get(value) ?? null)
    assert.equal(registry.entries[0].trusted, source === termousToolSource)
    if (source === termousToolSource) assert.match(registry.entries[0].tool.description, /^原始参数说明/u)
    else assert.equal(registry.entries[0].tool.description, '完整传输说明')
  }
})

test('当前指引按能力去重，替代入口反映实际声明且不自动执行或加载', () => {
  const names = ['termous.local.files.read', 'termous.local.commands.execute', 'termous.desktops.capture']
  const discovery = new RuntimeToolDiscovery(names.map(tool), name => name, [])
  discovery.loadNames(names.slice(0, 2))
  const published = discovery.publish()
  const rows = capabilitySelectionGuidance(discovery.registry, published, name => discovery.available(name))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].current_capability, 'local_system')
  assert.equal(rows[0].alternatives![0].tools[0].status, 'discoverable')
  assert.equal(discovery.declaration(names[2]).status, 'discoverable')
  discovery.loadNames([names[2]])
  const next = capabilitySelectionGuidance(discovery.registry, discovery.publish(), name => discovery.available(name))
  assert.equal(next.find(row => row.current_capability === 'local_system')!.alternatives![0].tools[0].status, 'declared')
  const restricted = capabilitySelectionGuidance(discovery.registry, published, name => name !== names[2])
  assert.equal(restricted[0].alternatives, undefined)
  assert.equal(capabilitySelectionGuidance(discovery.registry, [], () => true).length, 0)
  assert.ok(Buffer.byteLength(discovery.index()) <= 12 * 1024)
})

test('新能力只提供元数据即可参与默认入口和说明投影，不需要工具名分支', () => {
  const capability: ToolCapability = { ...runtimeCapability('termous.local.files.read')!, id: 'fixture_domain', prefix: 'termous.fixture.',
    selection: { use_when: 'A new domain can describe its own task.' },
    discovery: { summary: 'Fixture domain', entry: ['inspect'], preload: [{ tool: 'inspect', bindings: ['default'], priority: 0 }] } }
  const name = 'termous.fixture.inspect'
  assert.deepEqual(initialTools([{ original: name, trusted: true, capability }], [], () => true), [name])
  const projected = describeCapabilityTool(tool(name), name, capability)
  assert.match(projected.description, /职责：/u)
  assert.equal(describeCapabilityTool(projected, name, capability).description, projected.description)
  const legacy = { ...capability, selection: undefined }
  assert.doesNotMatch(describeCapabilityTool(tool(name), name, legacy).description, /Use when:/)
})

test('自然语言用途可以召回不同动作，显式动作和来源保持边界，历史不召回无关能力', async () => {
  const names = ['termous.local.commands.execute', 'termous.desktops.capture', 'termous.desktops.execute']
  const discovery = new RuntimeToolDiscovery(names.map(tool), name => name, [])
  const capture = discovery.registry.entries.find(entry => entry.original === names[1])!
  assert.ok(createToolSearch({ query: '启动应用' })(capture) > 0)
  assert.equal(createToolSearch({ query: '启动应用', operation: 'run' })(capture), 0)
  assert.equal(createToolSearch({ query: capture.original, operation: 'run' })(capture), 0)
  assert.equal(createToolSearch({ names: [capture.original], operation: 'run' })(capture), 0)
  assert.equal(createToolSearch({ query: '火星飞船', operation: 'run' }, new Set(['local_system']))(discovery.registry.entries[0]), 0)
  const response = await discovery.tool.execute('find', { query: '打开浏览器', source: 'local' })
  const body = JSON.parse(response.content.find(part => part.type === 'text')!.text)
  assert.ok(body.tools.every((entry: { source: string }) => entry.source === 'local'))
  discovery.loadNames(names)
  const published = discovery.publish()
  for (const name of names) assert.ok(published.some(entry => entry.name === name))
})

test('根 Skill 入口跨能力公平加载，缺失和不可用项不占八个名额', () => {
  const names = runtimeCapabilities.filter(capability => capability.skill.startsWith('skill://termous-remote-desktop/'))
    .flatMap(capability => capability.discovery.entry.map(name => capability.prefix + name))
  const discovery = new RuntimeToolDiscovery([...new Set(names)].map(tool), name => name, [], name => name.endsWith('.capture') ? '暂不可用' : undefined)
  const loaded = discovery.loadReferencedTools('', 'skill://termous-remote-desktop/SKILL.md')
  assert.ok(loaded.length <= 8)
  assert.ok(!loaded.some(entry => entry.original_name.endsWith('.capture')))
  assert.ok(loaded.some(entry => entry.original_name === 'termous.desktops.pointer.click'))
  assert.ok(loaded.some(entry => entry.original_name === 'termous.desktops.execute'))
})

test('所有根 Skill 从完整所属能力推导入口，专项说明仍保留自己的入口', () => {
  const owners = new Set(runtimeCapabilities.map(capability => capability.skill.slice(0, capability.skill.indexOf('/', 'skill://'.length) + 1)))
  for (const owner of owners) {
    const expected = new Set(runtimeCapabilities.filter(capability => capability.skill.startsWith(owner))
      .flatMap(capability => capability.discovery.entry.map(name => capabilityToolName(capability, name))))
    assert.deepEqual(new Set(skillEntryTools(owner + 'SKILL.md')), expected)
  }
  assert.deepEqual(skillEntryTools('skill://termous-desktop-workflows/references/ocr.md'), [
    'termous.desktop_workflows.schema', 'termous.desktop_workflows.ocr.test',
  ])
})

test('完整目录下当前能力指引仍可见，重建和五十次切换保持有界', () => {
  const names = runtimeCapabilities.flatMap(capability => capability.steps.flatMap(step => step.tools.map(name => name.startsWith('termous.') || name.startsWith('wait_') ? name : capability.prefix + name)))
  for (let index = 0; index < 50; index++) {
    const discovery = new RuntimeToolDiscovery(names.map(tool), name => name, [])
    discovery.preload([])
    const before = discovery.index()
    assert.match(before, /"current_capability":"local_system"/)
    discovery.loadNames(['termous.desktops.capture'])
    const published = discovery.publish()
    const after = discovery.index(published)
    assert.match(after, /"current_capability":"desktop_sessions"/)
    assert.notEqual(before, after)
    assert.ok(Buffer.byteLength(after) <= 12 * 1024)
    assert.ok(published.length <= 32)
  }
})

test('声明接近上限时保留各当前能力用途和跨域概览，完整替代说明按需发现', () => {
  const names = runtimeCapabilities.flatMap(capability => capability.steps.flatMap(step => step.tools.map(name => capabilityToolName(capability, name))))
  const discovery = new RuntimeToolDiscovery(names.map(tool), name => name, [])
  discovery.loadNames(runtimeCapabilities.flatMap(capability => [capabilityToolName(capability, capability.discovery.entry[0])]))
  const published = discovery.publish()
  const index = discovery.index(published)
  const current = new Set(published.flatMap(entry => runtimeCapability(entry.name) ? [runtimeCapability(entry.name)!.id] : []))
  for (const id of current) assert.ok(index.includes(JSON.stringify({ current_capability: id }).slice(0, -1)), id)
  assert.match(index, /termous\/desktop/)
  assert.match(index, /termous\/system/)
  assert.match(index, /local\/local/)
  assert.ok(Buffer.byteLength(index) <= 12 * 1024)
})

test('同等相关性保留来源多样性，继续分页不重复、不遗漏、不受上一页偏好变化影响', async () => {
  const tools = Array.from({ length: 12 }, (_, index) => identifyTool({ ...tool(`inspect_${index}`), description: 'inspect resource' }, externalToolSource('alpha')))
  tools.push(identifyTool({ ...tool('inspect_other'), description: 'inspect resource' }, externalToolSource('beta')))
  const discovery = new RuntimeToolDiscovery(tools, name => name, [])
  let cursor: string | undefined
  const seen: string[] = []
  do {
    const result = await discovery.tool.execute('page', { query: 'inspect', limit: 3, ...(cursor ? { cursor } : {}) })
    const body = JSON.parse(result.content.find(part => part.type === 'text')!.text)
    if (!cursor) assert.equal(new Set(body.tools.map((entry: { source: string }) => entry.source)).size, 2)
    seen.push(...body.tools.map((entry: { name: string }) => entry.name))
    discovery.publish()
    cursor = body.next_cursor
  } while (cursor)
  assert.equal(seen.length, tools.length)
  assert.equal(new Set(seen).size, tools.length)
})
