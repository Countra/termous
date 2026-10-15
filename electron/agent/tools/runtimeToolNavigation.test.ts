import assert from 'node:assert/strict'
import test from 'node:test'
import { Compile } from 'typebox/compile'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { runtimeToolDependencies } from './runtimeToolLifecycle.ts'

function fixture(errorCode?: string, names = ['list', 'get', 'attach', 'capture', 'keyboard.key']) {
  const calls: string[] = []
  const mapped = mapMCPTools(names.map((name) => ({ name: `termous.desktops.${name}`, description: name, inputSchema: { type: 'object' as const, properties: {} } })), async (definition) => {
    calls.push(definition.name)
    const result = errorCode ? { error: { code: errorCode, retryable: false } } : { sessions: [{ session_id: 'fixture', connection_generation: 2 }] }
    return { isError: Boolean(errorCode), content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
  })
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  return { discovery, calls, mapped }
}

test('精确名称或能力组独立发现，空参数及过量名称仍被校验拒绝', async () => {
  const { discovery } = fixture()
  const schema = Compile(discovery.tool.parameters)
  assert.equal(schema.Check({ names: ['termous.desktops.list'] }), true)
  assert.equal(schema.Check({ group: 'desktop_observe' }), true)
  for (const value of [{}, { names: [] }, { query: '' }, { group: 'invented' }, { names: Array(9).fill('list') }]) assert.equal(schema.Check(value), false)
  await discovery.tool.execute('find', { names: ['termous.desktops.list'] })
  assert.deepEqual(discovery.publish().map((tool) => tool.name), ['discover_tools', 'm_termous_ddesktops_dlist'])
})

test('只加载 list 后真实调用会在下一轮补齐 get 与 attach，不自动派发任何后续操作', async () => {
  const { discovery, calls } = fixture()
  await discovery.tool.execute('find', { names: ['termous.desktops.list'] })
  const list = discovery.publish().find((tool) => tool.name.endsWith('_dlist'))!
  const result = await list.execute('call', {})
  assert.deepEqual(calls, ['termous.desktops.list'])
  assert.equal(discovery.active().some((tool) => tool.name.endsWith('_dattach')), false)
  assert.match(JSON.stringify(result.content), /available_next_turn.*m_termous_ddesktops_dattach/u)
  assert.deepEqual(discovery.publish().map((tool) => tool.name), ['discover_tools', 'm_termous_ddesktops_dattach', 'm_termous_ddesktops_dget', 'm_termous_ddesktops_dlist'])
})

test('代次失效加载重新观察工具，保留原错误和禁止重放说明', async () => {
  const { discovery, calls } = fixture('desktop_generation_stale')
  await discovery.tool.execute('find', { names: ['termous.desktops.keyboard.key'] })
  const key = discovery.publish().find((tool) => tool.name.endsWith('_dkey'))!
  const result = await key.execute('call', {})
  assert.match(JSON.stringify(result.content), /desktop_generation_stale/u)
  assert.match(JSON.stringify(result.content), /不得重用或自动重放/u)
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('_dget')))
  assert.equal(calls.length, 1)
})

test('已失败附着或会话不会被导航当成仍在准备，禁止建议反复新建附着', () => {
  for (const data of [{ attachment: { state: 'failed', reason: 'desktop_generation_stale' } }, { session: { status: 'failed' } }]) {
    const navigation = runtimeToolNavigation('termous.desktops.get', { content: [], details: {
      kind: 'mcp', originalToolName: 'termous.desktops.get', result: { content: [], structuredContent: data },
    } })
    assert.deepEqual(navigation?.names, ['termous.desktops.get'])
    assert.match(navigation!.guidance, /A failed state must not be treated as ready/)
  }
})

test('导航不加载未授权工具，不把权限拒绝当成重新附着指令', async () => {
  const restricted = fixture(undefined, ['list'])
  await restricted.discovery.tool.execute('find', { names: ['termous.desktops.list', 'termous.desktops.attach'] })
  const active = restricted.discovery.publish()
  const result = await active[1]!.execute('call', {})
  const hint = result.content[result.content.length - 1]!
  assert.equal(hint.type, 'text')
  if (hint.type === 'text') assert.deepEqual(JSON.parse(hint.text).tool_navigation.available_next_turn, [])
  assert.equal(restricted.discovery.publish().length, 2)
  const denied = fixture('forbidden')
  await denied.discovery.tool.execute('find', { names: ['termous.desktops.keyboard.key'] })
  const key = denied.discovery.publish().find((tool) => tool.name.endsWith('_dkey'))!
  await key.execute('call', {})
  assert.equal(denied.discovery.publish().some((tool) => tool.name.endsWith('_dattach')), false)
})

test('精确工具名优先于不一致的组提示，缺失名称明确返回', async () => {
  const { discovery } = fixture()
  const result = await discovery.tool.execute('find', { names: ['termous.desktops.attach', 'termous.desktop_workflows.edit'], group: 'workflow_edit' })
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('_dattach')))
  assert.match(JSON.stringify(result.content), /not_found.*termous.desktop_workflows.edit/u)
})

test('仅观察不提前加载 control.release，申请控制搜索不会以归还工具代替', async () => {
  const { discovery } = fixture(undefined, ['list', 'attach', 'capture', 'control.acquire', 'control.release'])
  await discovery.tool.execute('observe', { names: ['termous.desktops.list'] })
  assert.ok(!discovery.publish().some((tool) => tool.name.endsWith('_drelease')))
  const found = await discovery.tool.execute('control', { query: '申请控制权', group: 'desktop_input' })
  const part = found.content[0]!
  assert.equal(part.type, 'text')
  if (part.type === 'text') assert.deepEqual(JSON.parse(part.text).tools.map((tool: { original_name: string }) => tool.original_name), ['termous.desktops.control.acquire'])
  const active = discovery.publish()
  assert.ok(active.some((tool) => tool.name.endsWith('_dacquire')))
  assert.ok(active.some((tool) => tool.name.endsWith('_drelease')))
})

test('精确目标不可用时返回空结果，不回退到同组相似操作', async () => {
  const { discovery } = fixture(undefined, ['control.release'])
  const found = await discovery.tool.execute('missing', { query: '申请控制权', group: 'desktop_input' })
  const part = found.content[0]!
  if (part.type === 'text') assert.deepEqual(JSON.parse(part.text).tools, [])
  assert.deepEqual(discovery.publish().map((tool) => tool.name), ['discover_tools'])
})

test('准备中的附着只等待，ready 后加载准确控制入口且不自动取得授权', () => {
  for (const name of ['termous.desktops.attach', 'termous.desktops.get']) {
    for (const state of ['preparing', 'ready']) {
      const result = { content: [], details: { kind: 'mcp', originalToolName: name, result: { content: [], structuredContent: { attachment: { id: 'a', state } } } } }
      const navigation = runtimeToolNavigation(name, result)!
      assert.deepEqual(navigation.names, state === 'ready' ? ['termous.desktops.capture', 'termous.desktops.control.acquire'] : ['termous.desktops.get'])
    }
  }
})

test('执行保护撤下副作用工具，重新发现也不能恢复，导航保留只读入口', async () => {
  const { mapped } = fixture(undefined, ['get', 'capture', 'control.acquire', 'control.release'])
  let restricted = false
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [],
    (name) => restricted && name.includes('.control.') ? '清理未确认，仅可只读核查' : undefined)
  await discovery.tool.execute('find', { names: ['termous.desktops.control.acquire', 'termous.desktops.get'] })
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('_dacquire')))
  restricted = true
  assert.ok(!discovery.publish().some((tool) => tool.name.includes('_dcontrol_')))
  const found = await discovery.tool.execute('again', { names: ['termous.desktops.control.acquire'] })
  assert.match(JSON.stringify(found.content), /unavailable.*清理未确认/u)
  assert.ok(!discovery.publish().some((tool) => tool.name.includes('_dcontrol_')))
})

test('统一动作索引按文件能力选择实际存在的正文保存工具', async () => {
  const mapped = mapMCPTools([{ name: 'termous.files.save_text', description: '编辑文件正文', inputSchema: { type: 'object', properties: {} } }], async () => ({ content: [] }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  await discovery.tool.execute('find', { group: 'files', query: '编辑文件' })
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('_dsave_utext')))
})

test('工作流查询编辑不加载释放入口，创建资源只保留对应清理工具', async () => {
  const names = ['runs.get', 'update', 'captures.create', 'captures.view', 'captures.release', 'templates.preview', 'templates.discard', 'runs.control']
  const mapped = mapMCPTools(names.map((name) => ({ name: `termous.desktop_workflows.${name}`, inputSchema: { type: 'object' as const, properties: {} } })), async () => ({ content: [] }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  await discovery.tool.execute('find', { names: ['termous.desktop_workflows.runs.get', 'termous.desktop_workflows.update'] })
  assert.deepEqual(discovery.publish().map((tool) => mapped.originalNames.get(tool.name) ?? tool.name), ['discover_tools', 'termous.desktop_workflows.runs.get', 'termous.desktop_workflows.update'])
  for (const query of ['创建新快照', 'create snapshot', '获取快照']) {
    const result = await discovery.tool.execute('capture', { group: 'workflow_templates', query })
    const text = result.content[0]!
    if (text.type === 'text') assert.deepEqual(JSON.parse(text.text).tools.map((tool: { original_name: string }) => tool.original_name), ['termous.desktop_workflows.captures.create'])
  }
  assert.ok(discovery.publish().some((tool) => tool.name.endsWith('_dcaptures_drelease')))
  assert.ok(!discovery.active().some((tool) => tool.name.endsWith('_ddiscard')))
  const release = await discovery.tool.execute('release', { group: 'workflow_templates', query: '释放旧快照' })
  assert.ok(release.content[0]?.type === 'text' && JSON.parse(release.content[0].text).tools.every((tool: { original_name: string }) => tool.original_name.endsWith('captures.release')))
})

test('截图创建工具不可用时不以释放替代；导航仅加载授权声明', async () => {
  const mapped = mapMCPTools([{ name: 'termous.desktop_workflows.captures.release', inputSchema: { type: 'object', properties: {} } }], async () => ({ content: [], structuredContent: { completed: true } }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  const result = await discovery.tool.execute('capture', { query: '创建快照' })
  assert.ok(result.content[0]?.type === 'text' && JSON.parse(result.content[0].text).tools.length === 0)
  assert.equal(discovery.publish().length, 1)
  await discovery.tool.execute('release', { names: ['termous.desktop_workflows.captures.release'] })
  const released = await discovery.publish()[1]!.execute('release', {})
  assert.match(JSON.stringify(released.content), /Use captures\.create to create a new snapshot/u)
  assert.equal(discovery.publish().length, 2)
})

test('其他领域同样按资源创建保留清理入口，只读查询不先暴露关闭或取消', () => {
  for (const name of ['termous.hosts.list', 'termous.sessions.get', 'termous.files.list', 'termous.files.transfers.get', 'termous.forwarding.instances.get', 'termous.desktop_workflows.schema']) assert.deepEqual(runtimeToolDependencies(name), [])
  for (const [name, cleanup] of [
    ['termous.sessions.connect', 'termous.sessions.close'],
    ['termous.commands.dispatch', 'termous.commands.interrupt'],
    ['termous.files.sessions.connect', 'termous.files.sessions.close'],
    ['termous.files.sessions.reconnect', 'termous.files.sessions.close'],
    ['termous.files.transfers.upload', 'termous.files.transfers.cancel'],
    ['termous.files.transfers.download', 'termous.files.transfers.cancel'],
    ['termous.files.transfers.remote_copy', 'termous.files.transfers.cancel'],
    ['termous.files.delete.start', 'termous.files.delete.cancel'],
    ['termous.files.batch_rename.start', 'termous.files.batch_rename.cancel'],
    ['termous.forwarding.instances.start', 'termous.forwarding.instances.stop'],
  ]) assert.ok(runtimeToolDependencies(name!).includes(cleanup!), name)
})
