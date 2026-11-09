import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { externalToolSource, identifyTool } from '../contracts/toolSources.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'

const definition = (name: string) => ({ name, description: name, inputSchema: { type: 'object' as const, properties: {} } })
const originalName = (mapped: ReturnType<typeof mapMCPTools>) => (name: string) => mapped.originalNames.get(name) ?? null

test('预加载和目录恢复只恢复声明，不冒充主动发现或激活完整说明', async () => {
  const mapped = mapMCPTools([definition('termous.desktops.sources')], async () => ({ content: [] }))
  const loaded: string[] = []
  const make = () => new RuntimeToolDiscovery(mapped.tools, originalName(mapped), [], undefined, name => loaded.push(name))
  const first = make()
  first.preload([])
  assert.deepEqual(loaded, [])
  await first.tool.execute('find', { names: ['termous.desktops.sources'] })
  assert.deepEqual(loaded, ['termous.desktops.sources'])
  const second = make()
  await second.restoreNames(first.retainedNames())
  assert.deepEqual(loaded, ['termous.desktops.sources'])
  assert.equal(second.declaration('termous.desktops.sources', second.publish()).status, 'declared')
})

test('目录更新后按唯一模型名称重新读取外部声明，不丢失选择或沿用旧参数', async () => {
  const source = externalToolSource('fixture')
  const name = 'termous.desktops.capture'
  const firstTools = mapMCPTools([definition(name)], async () => ({ content: [] }), source)
  const oldSchema = Type.Object({ old_value: Type.String() })
  const first = new RuntimeToolDiscovery(firstTools.tools, originalName(firstTools), [], undefined, undefined, undefined, async () => oldSchema)
  await first.tool.execute('find', { names: [firstTools.tools[0].name] })
  first.publish()
  const nextTools = mapMCPTools([definition(name)], async () => ({ content: [] }), source)
  const nextSchema = Type.Object({ new_value: Type.Number() })
  let definitions = 0
  const next = new RuntimeToolDiscovery(nextTools.tools, originalName(nextTools), [], undefined, undefined, undefined, async () => { definitions++; return nextSchema })
  await next.restoreNames(first.retainedNames())
  const published = next.publish()
  assert.equal(definitions, 1)
  assert.equal(published.find(tool => tool.name === nextTools.tools[0].name)?.parameters, nextSchema)
  assert.equal(next.declaration(name).status, 'unavailable')
})

test('外部声明刷新失败或撤下后不恢复旧声明，取消仍向上传递', async () => {
  const mapped = mapMCPTools([definition('inspect')], async () => ({ content: [] }), externalToolSource('fixture'))
  const name = mapped.tools[0].name
  const denied = new RuntimeToolDiscovery(mapped.tools, originalName(mapped), [], undefined, undefined, undefined, async () => { throw new Error('INTEGRATION_TOOL_CHANGED') })
  await denied.restoreNames([name])
  assert.ok(!denied.publish().some(tool => tool.name === name))
  const missing = new RuntimeToolDiscovery([], originalName(mapped), [])
  await missing.restoreNames([name])
  assert.ok(!missing.publish().some(tool => tool.name === name))
  const controller = new AbortController()
  const cancelled = new RuntimeToolDiscovery(mapped.tools, originalName(mapped), [], undefined, undefined, undefined, async () => {
    controller.abort()
    return Type.Object({})
  })
  await assert.rejects(cancelled.restoreNames([name], controller.signal), { name: 'AbortError' })
  assert.ok(!cancelled.publish().some(tool => tool.name === name))
})

test('目录多次重建和淘汰后只保留占位 Schema，不累计完整声明', async () => {
  const mapped = mapMCPTools(Array.from({ length: 40 }, (_, index) => definition(`inspect_${index}`)), async () => ({ content: [] }), externalToolSource('fixture'))
  const schema = Type.Object({ payload: Type.String() })
  const make = (tools = mapped.tools) => new RuntimeToolDiscovery(tools, originalName(mapped), [], undefined, undefined, undefined, async () => schema)
  let discovery = make()
  await discovery.tool.execute('find', { names: [mapped.tools[0].name] })
  discovery.publish()
  for (let index = 0; index < 3; index++) {
    const next = make(discovery.catalogTools())
    await next.restoreNames(discovery.retainedNames())
    next.publish()
    discovery = next
  }
  for (let index = 1; index < mapped.tools.length; index += 8) {
    await discovery.tool.execute('find', { names: mapped.tools.slice(index, index + 8).map(tool => tool.name) })
    discovery.publish()
  }
  const evicted = discovery.registry.entries.find(entry => entry.tool.name === mapped.tools[0].name)!
  assert.deepEqual(evicted.tool.parameters, mapped.tools[0].parameters)
  assert.notEqual(evicted.tool.parameters, schema)
})

test('只有外部合同版本变化时也使旧游标失效，不能由相同的占位 Schema 掩盖更新', async () => {
  const source = externalToolSource('fixture')
  const make = (version: string) => {
    const mapped = mapMCPTools(['one', 'two'].map(definition), async () => ({ content: [] }), source)
    for (const tool of mapped.tools) identifyTool(tool, source, mapped.originalNames.get(tool.name)!.split('::')[1], version)
    return new RuntimeToolDiscovery(mapped.tools, originalName(mapped), [])
  }
  const first = make('version-1')
  const result = await first.tool.execute('page', { limit: 1 })
  const body = JSON.parse(result.content.find(part => part.type === 'text')!.text)
  assert.ok(body.next_cursor)
  await assert.rejects(make('version-2').tool.execute('next', { limit: 1, cursor: body.next_cursor }), /CURSOR_STALE/)
  await make('version-1').tool.execute('same', { limit: 1, cursor: body.next_cursor })
})
