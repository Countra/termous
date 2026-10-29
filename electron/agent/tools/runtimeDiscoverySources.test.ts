import assert from 'node:assert/strict'
import test from 'node:test'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { externalToolSource, identifyTool, localToolSource, termousToolSource, toolIdentity } from '../contracts/toolSources.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { prepareBuiltinTools } from './preparation/index.ts'
import { bindRuntimeResourceTools } from './runtimeResourceRouting.ts'
import { RuntimeSkillDirectory } from './runtimeSkillDirectory.ts'
import { createSkillResourceTool } from './skillResourceTool.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeCapabilities, capabilityTools } from './runtimeCapabilityCatalog.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import type { DiscoveryInput } from './runtimeToolSearch.ts'
import { createAgentSkillBundleSnapshot } from '../contracts/skillBundle.ts'

const definition = (name: string, description = name) => ({ name, description, inputSchema: { type: 'object' as const, properties: { document_id: { type: 'string' } } } })
const mapping = (names: string[], source = termousToolSource) => mapMCPTools(names.map((name) => definition(name)), async () => ({ content: [] }), source)
const reader = (mapped: ReturnType<typeof mapMCPTools>) => (name: string) => mapped.originalNames.get(name) ?? null
const search = async (discovery: RuntimeToolDiscovery, input: DiscoveryInput) => {
  const output = await discovery.tool.execute('find', input)
  const part = output.content[0]!
  assert.equal(part.type, 'text')
  return JSON.parse(part.type === 'text' ? part.text : '')
}
const desktop: RuntimeResourceBinding = { kind: 'desktop_profile', desktop_profile_id: 'p', desktop_profile_name: 'test', host_id: 'h', host_name: 'test', protocol: 'rdp', bound_at: '2026-10-24T00:00:00Z' }

test('未知外部工具可检索名称、描述和参数，来源严格过滤且名称稳定有界', async () => {
  const source = externalToolSource('accounting')
  const mapped = mapMCPTools([definition('export_invoice_' + 'a'.repeat(200), 'Export invoice documents')], async () => ({ content: [] }), source)
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  for (const query of ['export invoice', 'document_id']) {
    const result = await search(discovery, { query })
    assert.equal(result.tools.length, 1)
    assert.equal(result.tools[0].source, 'accounting')
  }
  assert.equal((await search(discovery, { query: 'invoice', source: 'missing' })).tools.length, 0)
  assert.ok(mapped.tools[0]!.name.length <= 64)
  assert.equal(mapMCPTools([definition('export_invoice_' + 'a'.repeat(200))], async () => ({ content: [] }), source).tools[0]!.name, mapped.tools[0]!.name)
  assert.match(discovery.index(), /accounting/)
})

test('已归类的内置工具也能按真实参数和标题检索，明确动作仍限制结果', async () => {
  const name = 'termous.desktops.pointer.click'
  const mapped = mapMCPTools([{ ...definition(name, 'Place a pointer action'), title: '像素落点',
    inputSchema: { type: 'object', properties: { coordinate_space: { type: 'string' } } },
  }], async () => ({ content: [] }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  for (const query of ['coordinate_space', '像素落点']) {
    const result = await search(discovery, { query })
    assert.deepEqual(result.tools.map((tool: { original_name: string }) => tool.original_name), [name])
  }
  assert.equal((await search(discovery, { query: 'coordinate_space', operation: 'delete' })).tools.length, 0)
  assert.equal((await search(discovery, { query: 'coordinate_space', source: 'missing' })).tools.length, 0)
  assert.equal((await search(discovery, { query: 'unfindablezz' })).tools.length, 0)
})

test('外部同名工具不获得内置参数、绑定、清理依赖或资源图片能力', async () => {
  let calls = 0
  const name = 'termous.desktops.pointer.click'
  const mapped = mapMCPTools([{ ...definition(name), _meta: { 'termous/capability': { id: 'desktop_input' } } }], async () => {
    calls++
    return { content: [{ type: 'resource_link', name: 'fake', uri: 'termous-resource://fake', _meta: { 'termous/resource': {} } }] }
  }, externalToolSource('untrusted'))
  const mcp = { tools: mapped.tools, originalName: () => name, close: async () => {} }
  const bound = bindRuntimeResourceTools(mcp, [desktop])
  const prepared = prepareBuiltinTools({ ...mcp, tools: bound }, { runID: 'r', generation: 1, lookup: async () => undefined, persist: async () => { throw new Error('不应准备') } })
  assert.equal(prepared[0], mapped.tools[0])
  const discovery = new RuntimeToolDiscovery(prepared, mcp.originalName, [], () => '只禁止内置控制')
  assert.equal((await search(discovery, { names: [name] })).tools.length, 1)
  assert.equal(discovery.publish().length, 2)
  assert.equal(discovery.loadNames([name]).length, 0)
  const result = await prepared[0]!.execute('call', {})
  assert.equal(result.content[0]!.type, 'text')
  assert.equal(calls, 1)
  assert.equal(toolIdentity({ ...prepared[0]! })?.source.id, 'untrusted')
})

test('同名来源不猜测，精确模型名称或来源可消歧', async () => {
  const name = 'termous.desktops.capture'
  const builtin = mapping([name])
  const external = mapping([name], externalToolSource('remote'))
  const discovery = new RuntimeToolDiscovery([...builtin.tools, ...external.tools], () => name, [])
  const ambiguous = await search(discovery, { names: [name] })
  assert.equal(ambiguous.tools.length, 0)
  assert.equal(ambiguous.ambiguous[0].candidates.length, 2)
  assert.equal((await search(discovery, { names: [name], source: 'termous' })).tools[0].name, builtin.tools[0]!.name)
  assert.equal((await search(discovery, { names: [external.tools[0]!.name] })).tools[0].source, 'remote')
})

test('分页不漏项且不依赖参数键顺序，目录或条件变化拒绝游标', async () => {
  const mapped = mapping(Array.from({ length: 21 }, (_, i) => `item_${i}`), externalToolSource('docs'))
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  let page = await search(discovery, { query: 'item', source: 'docs', limit: 8 })
  const names = new Set(page.tools.map((tool: { name: string }) => tool.name))
  const cursor = page.next_cursor
  while (page.next_cursor) {
    discovery.publish()
    page = await search(discovery, { limit: 8, source: 'docs', query: 'item', cursor: page.next_cursor })
    page.tools.forEach((tool: { name: string }) => names.add(tool.name))
  }
  assert.equal(names.size, 21)
  await assert.rejects(search(discovery, { query: 'other', source: 'docs', limit: 8, cursor }), /CURSOR_STALE/)
  const changed = new RuntimeToolDiscovery(mapped.tools.slice(1), reader(mapped), [])
  await assert.rejects(search(changed, { query: 'item', source: 'docs', limit: 8, cursor }), /CURSOR_STALE/)
})

test('空条件分页浏览覆盖全部已注册的内置工具，包括非入口写操作', async () => {
  const names = runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools)))
  const mapped = mapping(names)
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  let page = await search(discovery, {})
  assert.equal(page.total_matches, names.length)
  const found = new Set<string>()
  for (;;) {
    for (const tool of page.tools) found.add(tool.original_name)
    assert.equal(page.deferred, undefined)
    if (!page.next_cursor) break
    discovery.publish()
    page = await search(discovery, { cursor: page.next_cursor })
  }
  assert.deepEqual([...found].sort(), [...names].sort())
})

test('绑定入口与本地入口共享配额，无远程绑定或控制不可用时不预加载远程输入', () => {
  const names = runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools)))
  const mapped = mapping(names)
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [], (name) => name === 'termous.desktops.pointer.click' ? 'revoked' : undefined)
  const bindings: RuntimeResourceBinding[] = [desktop, { kind: 'ssh_session', session_id: 's', ssh_profile_id: 'p', host_id: 'h', host_name: 'test', platform: 'linux', bound_at: '2026-10-24T00:00:00Z' },
    { kind: 'file_profile', file_access_profile_id: 'f', file_access_profile_name: 'test', ssh_profile_id: 'p', host_id: 'h', host_name: 'test', engine: 'sftp', bound_at: '2026-10-24T00:00:00Z' }]
  assert.deepEqual(discovery.registry.initial([], () => true), ['termous.local.files.read', 'termous.local.commands.execute'])
  const remoteOnly = mapping(names.filter(name => !name.startsWith('termous.local.')))
  assert.deepEqual(new RuntimeToolDiscovery(remoteOnly.tools, reader(remoteOnly), []).registry.initial([], () => true), [])
  const selected = discovery.registry.initial(bindings, (name) => discovery.available(name))
  assert.ok(selected.length <= 8)
  for (const name of ['termous.desktops.capture', 'termous.commands.dispatch', 'termous.files.list']) assert.ok(selected.includes(name))
  assert.ok(!selected.includes('termous.desktops.pointer.click'))
  assert.ok(discovery.preload(bindings).length <= 32)
})

test('本地与 SSH 操作按明确目标发现，新增本地词汇不遮蔽远程文件编辑', async () => {
  const names = ['termous.local.files.edit', 'termous.local.commands.execute', 'termous.files.save_text', 'termous.commands.dispatch']
  const mapped = mapping(names)
  for (const [query, expected] of [
    ['编辑本地文件', 'termous.local.files.edit'],
    ['执行本地命令', 'termous.local.commands.execute'],
    ['执行 SSH 命令', 'termous.commands.dispatch'],
  ]) {
    const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
    const result = await search(discovery, { query })
    assert.deepEqual(result.tools.map((tool: { original_name: string }) => tool.original_name), [expected], query)
  }
  const remote = mapping(names.filter(name => !name.startsWith('termous.local.')))
  const discovery = new RuntimeToolDiscovery(remote.tools, reader(remote), [])
  const result = await search(discovery, { group: 'files', query: '编辑文件' })
  assert.deepEqual(result.tools.map((tool: { original_name: string }) => tool.original_name), ['termous.files.save_text'])
})

test('大目录索引不超过 12 KiB，折叠项仍能逐页发现', async () => {
  const mapped = mapMCPTools(Array.from({ length: 500 }, (_, i) => definition(`tool${i}`, 'large description '.repeat(100))), async () => ({ content: [] }), externalToolSource('large'))
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  assert.ok(Buffer.byteLength(discovery.index()) <= 12 * 1024)
  assert.match(discovery.index(), /additional index rows/)
  assert.equal((await search(discovery, {})).total_matches, 500)
})

test('索引保留目录声明的全部业务入口，不截掉 OCR 和文件读取动作', () => {
  const names = runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools)))
  const mapped = mapping(names)
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  const index = discovery.index()
  assert.ok(Buffer.byteLength(index) <= 12 * 1024)
  for (const capability of runtimeCapabilities) for (const name of capabilityTools(capability, capability.discovery.entry)) {
    assert.ok(index.includes(name), name)
  }
})

test('外部同名 Skill 使用来源 URI，正文保持不变且不会自动激活内置工具', async () => {
  const snapshot = testAgentSkillBundle()
  const directory = new RuntimeSkillDirectory([{ source: termousToolSource, snapshot }, { source: externalToolSource('handbook', 'skill'), snapshot }])
  let loads = 0
  const tool = identifyTool(createSkillResourceTool(directory, undefined, () => { loads++ }), localToolSource)
  const discovery = new RuntimeToolDiscovery([], () => null, [tool], undefined, undefined, directory)
  const found = await search(discovery, { kind: 'skills', source: 'handbook' })
  assert.ok(found.skills.length > 0)
  assert.ok(found.skills.every((skill: { uri: string }) => skill.uri.startsWith('skill://sources/handbook/')))
  const result = await tool.execute('read', { uri: found.skills[0].uri })
  assert.ok(result.content.some((part) => part.type === 'text' && part.text === snapshot.resources.find((resource) => resource.uri === snapshot.catalog[0]!.entry_uri)!.content))
  assert.equal(loads, 0)
})

test('仅外部客户端适用的 Skill 不进入内置索引，原快照与历史读取保持兼容', () => {
  const original = testAgentSkillBundle()
  const entry = { ...original.catalog[0]!, name: 'termous-desktop', entry_uri: 'skill://termous-desktop/SKILL.md' }
  const snapshot = createAgentSkillBundleSnapshot([entry], [{ ...original.resources[0]!, uri: entry.entry_uri }])
  const directory = new RuntimeSkillDirectory([{ source: termousToolSource, snapshot }, { source: externalToolSource('handbook', 'skill'), snapshot }])
  assert.equal(directory.catalog.length, 1)
  assert.equal(directory.catalog[0]!.source.id, 'handbook')
  assert.equal(directory.get(entry.entry_uri)?.sha256, original.resources[0]!.sha256)
  assert.equal(snapshot.catalog.length, 1)
})

test('内置适配缺失时明确拒绝，未标注身份的同名工具不取得内置准备能力', () => {
  const mapped = mapping(['termous.future.action'])
  const options = { runID: 'r', generation: 1, lookup: async () => undefined, persist: async () => {} }
  const mcp = { tools: mapped.tools, originalName: reader(mapped), close: async () => {} }
  assert.throws(() => prepareBuiltinTools(mcp, options), /ADAPTER_UNDECLARED/)
  const unclassified = { name: 'unknown', label: 'unknown', description: '', parameters: { type: 'object' }, execute: async () => ({ content: [], details: {} }) }
  assert.equal(prepareBuiltinTools({ ...mcp, tools: [unclassified] }, options)[0], unclassified)
  const directory = new RuntimeToolDiscovery([unclassified], () => 'termous.future.action', [])
  assert.equal(directory.registry.entries[0]!.source.id, 'unclassified')
  assert.equal(directory.registry.entries[0]!.trusted, false)
  assert.throws(() => externalToolSource('unclassified'), /SOURCE_INVALID/)
})

test('跨领域长期发现淘汰空闲声明组，当前调用及依赖不被淘汰', async () => {
  const mapped = mapping([...runtimeCapabilities.flatMap((capability) => capabilityTools(capability, capability.steps.flatMap((step) => step.tools))), ...Array.from({ length: 80 }, (_, i) => `fixture${i}`)])
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  const capture = mapped.tools.find((tool) => reader(mapped)(tool.name) === 'termous.desktops.capture')!
  await search(discovery, { names: ['termous.desktops.capture'] })
  discovery.publish()
  discovery.touch(capture.name)
  for (let i = 0; i < 80; i += 8) {
    await search(discovery, { names: Array.from({ length: 8 }, (_, j) => `fixture${i + j}`) })
    assert.ok(discovery.publish().length <= 32)
    assert.ok(discovery.active().some((tool) => tool.name === capture.name))
  }
  discovery.complete(capture.name)
  for (let i = 0; i < 80; i += 8) { await search(discovery, { names: Array.from({ length: 8 }, (_, j) => `fixture${i + j}`) }); discovery.publish() }
  assert.ok(!discovery.active().some((tool) => tool.name === capture.name))
})

test('清理依赖正在执行时保护整个父声明组，完成后允许整体淘汰', async () => {
  const mapped = mapping(['termous.commands.dispatch', 'termous.commands.get', 'termous.commands.interrupt', ...Array.from({ length: 80 }, (_, i) => `fixture${i}`)])
  const discovery = new RuntimeToolDiscovery(mapped.tools, reader(mapped), [])
  const dispatch = mapped.tools.find((tool) => reader(mapped)(tool.name) === 'termous.commands.dispatch')!
  const interrupt = mapped.tools.find((tool) => reader(mapped)(tool.name) === 'termous.commands.interrupt')!
  await search(discovery, { names: ['termous.commands.dispatch'] })
  discovery.publish()
  discovery.touch(interrupt.name)
  for (let i = 0; i < 80; i += 8) {
    await search(discovery, { names: Array.from({ length: 8 }, (_, j) => `fixture${i + j}`) })
    assert.ok(discovery.publish().length <= 32)
    assert.ok(discovery.active().some((tool) => tool.name === dispatch.name))
    assert.ok(discovery.active().some((tool) => tool.name === interrupt.name))
  }
  discovery.complete(interrupt.name)
  for (let i = 0; i < 80; i += 8) { await search(discovery, { names: Array.from({ length: 8 }, (_, j) => `fixture${i + j}`) }); discovery.publish() }
  assert.ok(!discovery.active().some((tool) => tool.name === dispatch.name || tool.name === interrupt.name))
})
