import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { attachLocalTools } from '../worker/localTools.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { createToolSearch } from './runtimeToolSearch.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { progressData, progressResource } from './runtimeToolEvidence.ts'
import { projectLocalToolResult } from './runtimeLocalToolResult.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { externalToolName, externalToolSource, identifyTool, termousToolSource } from '../contracts/toolSources.ts'
import type { LocalToolContext } from '../contracts/localTools.ts'

const read = 'termous.local.files.read'
const execute = 'termous.local.commands.execute'
const context: LocalToolContext = {
  directory: { path: 'C:\\work', revision: 2, managed: false },
  environment: { platform: 'windows', default_shell: 'powershell', shells: [] },
  tools: {
    [read]: { description: 'Read a regular local file', inputSchema: Type.Object({ path: Type.String() }) },
    [execute]: { description: 'Execute an approved local command', inputSchema: Type.Object({ command: Type.String() }) },
  },
}
const error = (code = 'LOCAL_PATH_IS_DIRECTORY') => ({ error: { code, message: '目标是目录', details: {
  path: 'C:\\work\\target', expected_type: 'regular_file', actual_type: code === 'LOCAL_LINK_NOT_ALLOWED' ? 'symlink' : 'directory',
} } })
function connection(value: unknown = error()) {
  return attachLocalTools({ tools: [], originalName: () => null, close: async () => {} }, context, async () => value)
}

test('目录错误投影、实时导航和历史恢复保持一致，不复制正文', async () => {
  const mcp = connection()
  const result = await mcp.tools[0]!.execute('read', { path: 'target\\.' })
  const data = progressData(result)
  assert.deepEqual(data, projectLocalToolResult(JSON.parse(result.content.find(part => part.type === 'text')!.text)))
  const navigation = runtimeToolNavigation(read, result, [], true)!
  assert.deepEqual(navigation.names, [execute])
  assert.match(navigation.guidance, /directory.*regular files/u)
  const live = new RuntimeToolProgress()
  live.observe(read, { path: 'target\\.' }, result, true)
  const history = new RuntimeToolProgress()
  history.replay([{ role: 'toolResult', toolCallId: 'read', toolName: encodeMCPToolName(read), content: result.content,
    isError: true, timestamp: 1 }], () => true)
  assert.equal(live.snapshot().recoveries[0]!.guidance, history.snapshot().recoveries[0]!.guidance)
  assert.equal(live.snapshot().facts[0]!.resource, history.snapshot().facts[0]!.resource)
  assert.match(history.summary(), /historical/u)
  assert.doesNotMatch(history.summary(), /"next_tools"/u)
  const body = projectLocalToolResult({ text: JSON.stringify(error()), image_resource: { data: 'large image' },
    task: { id: 'task', status: 'running', command: 'private command', environment: { SECRET: 'private' } } })
  assert.deepEqual(body.task, { id: 'task', status: 'running' })
  assert.match(String(body.text_sha256), /^[a-f0-9]{64}$/u)
  assert.doesNotMatch(JSON.stringify(body), /private|large image|目标是目录/u)
  assert.notEqual(projectLocalToolResult({ text: 'before' }).text_sha256, projectLocalToolResult({ text: 'after' }).text_sha256)
})

test('路径书写变化不产生新资源，相对路径保留工作目录证据', async () => {
  const mcp = connection()
  const relative = progressData(await mcp.tools[0]!.execute('a', { path: 'target\\.' }))
  const absolute = progressData(await mcp.tools[0]!.execute('b', { path: 'C:\\work\\target' }))
  assert.equal(progressResource({}, relative, read), progressResource({}, absolute, read))
  assert.deepEqual(relative.local_file, { path: 'C:\\work\\target', working_directory: 'C:\\work', directory_revision: 2 })
  assert.equal(progressResource({ path: 'C:\\work\\target' }, {}, read), 'unresolved')
})

test('最新类型错误替代同一目标旧诊断，不恢复历史授权或扩大到其他路径', async () => {
  const progress = new RuntimeToolProgress()
  const old = await connection(error('UNAUTHORIZED')).tools[0]!.execute('old', { path: 'target' })
  const current = await connection().tools[0]!.execute('new', { path: 'target' })
  for (let i = 0; i < 3; i++) progress.observe(read, { path: 'target' }, old, true)
  progress.observe(read, { path: 'target' }, current, true)
  assert.match(progress.summary(), /LOCAL_PATH_IS_DIRECTORY/u)
  assert.doesNotMatch(progress.summary(), /UNAUTHORIZED/u)
  const restored = new RuntimeToolProgress()
  restored.restore(progress.snapshot())
  restored.observe(read, { path: 'target' }, old, true)
  assert.doesNotMatch(restored.summary(), /local\.commands\.execute/u)
})

test('权限、链接、审批和未知错误不能获得目录命令恢复建议', async () => {
  for (const code of ['LOCAL_LINK_NOT_ALLOWED', 'LOCAL_FILE_TYPE_UNSUPPORTED', 'LOCAL_PERMISSION_DENIED', 'LOCAL_PRIVATE_PATH', 'approval_rejected', 'LOCAL_TOOL_UNCERTAIN', 'LOCAL_TOOL_FAILED']) {
    const result = await connection(error(code)).tools[0]!.execute(code, { path: 'target' })
    assert(!runtimeToolNavigation(read, result, [], true)?.names.includes(execute), code)
  }
})

test('文件冲突引导重新读取，缺失和不支持类型不引导命令查询或变更', async () => {
  const mutationNames = ['termous.local.files.write', 'termous.local.files.edit']
  for (const tool of [read, ...mutationNames]) {
    const result = await connection(error('LOCAL_CONFLICT')).tools[0]!.execute('conflict', { path: 'target' })
    assert.deepEqual(runtimeToolNavigation(tool, result, [], true)!.names, [read])
    for (const code of ['LOCAL_NOT_FOUND', 'LOCAL_FILE_TYPE_UNSUPPORTED']) {
      const failed = await connection(error(code)).tools[0]!.execute(code, { path: 'target' })
      assert.deepEqual(runtimeToolNavigation(tool, failed, [], true)!.names, [])
    }
  }
  const directory = await connection().tools[0]!.execute('directory', { path: 'target' })
  for (const tool of mutationNames) assert.deepEqual(runtimeToolNavigation(tool, directory, [], true)!.names, [])
})

test('没有路径身份的旧认证失败仅作历史信息，当前目录诊断发布实际可调用名称', async () => {
  const progress = new RuntimeToolProgress()
  progress.replay([{ role: 'toolResult', toolCallId: 'old', toolName: encodeMCPToolName(read),
    content: [{ type: 'text', text: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'runtime token invalid' } }) }],
    isError: true, timestamp: 1 }], () => true)
  const mcp = connection()
  const discovery = new RuntimeToolDiscovery(mcp.tools, mcp.originalName, [])
  const current = await mcp.tools[0]!.execute('new', { path: 'target' })
  progress.observe(read, { path: 'target' }, current, true)
  discovery.navigate(runtimeToolNavigation(read, current, [], true)!)
  const published = discovery.publish()
  const summary = progress.summary(name => discovery.declaration(name, published))
  assert.match(summary, /LOCAL_PATH_IS_DIRECTORY/u)
  assert.match(summary, /"name":"m_termous_dlocal_dcommands_dexecute","source":"local","status":"declared"/u)
  const historical = progress.snapshot().recoveries.filter(item => item.origin === 'historical')
  assert(historical.every(item => !item.next_tools.includes(execute)))
})

test('用途召回命令但不改变显式 read 过滤，远程和外部来源保持独立', async () => {
  const mcp = connection()
  const discovery = new RuntimeToolDiscovery(mcp.tools, mcp.originalName, [])
  const query = '查看本地目录'
  const discovered = await discovery.tool.execute('search', { query, source: 'local' })
  assert.match(JSON.stringify(discovered.content), /commands\.execute/u)
  const filtered = await discovery.tool.execute('read-only', { query, operation: 'read', source: 'local' })
  const data = JSON.parse(filtered.content.find(part => part.type === 'text')!.text)
  assert(!data.tools.some((tool: { original_name: string }) => tool.original_name === execute))
  assert.equal(data.related_actions[0].discovery.arguments.operation, 'run')
  const skills = await discovery.tool.execute('skills', { query, operation: 'read', kind: 'skills' })
  assert.equal(JSON.parse(skills.content.find(part => part.type === 'text')!.text).related_actions, undefined)
  assert.equal(mcp.readOnly!(execute), false)
  const commandEntry = discovery.registry.entries.find(entry => entry.original === execute)!
  assert.equal(createToolSearch({ query: '读取本地文件，然后查看远程目录' })(commandEntry), 0)
  const remote = await discovery.tool.execute('remote', { query: '查看远程目录', source: 'termous' })
  assert.equal(JSON.parse(remote.content.find(part => part.type === 'text')!.text).tools.length, 0)
  const source = externalToolSource('outside')
  const spoof = identifyTool({ ...mcp.tools[0]!, name: externalToolName(source, read) }, source, read)
  const external = new RuntimeToolDiscovery([spoof], () => `${source.id}::${read}`, [])
  assert.equal(external.declaration(read).status, 'unavailable')
  assert.equal(external.loadNames([read, execute]).length, 0)
  const spoofedResult = await spoof.execute('external', { path: 'target' })
  assert(!runtimeToolNavigation(`${source.id}::${read}`, spoofedResult, [], true)?.names.includes(execute))
})

test('命令调用不能推断目录目标已完成，审批拒绝仍保留实际失败', async () => {
  const mcp = connection()
  const result = await mcp.tools[0]!.execute('read', { path: 'target' })
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe(read, { path: 'target' }, result, true)
  const denied = await connection({ error: { code: 'approval_rejected', message: '已拒绝' } }).tools[1]!.execute('command', { command: 'Get-Date' })
  progress.observe(execute, { command: 'Get-Date' }, denied, true)
  assert.equal(progress.snapshot().recoveries.some(entry => entry.tool === read), true)
  assert.equal(progress.snapshot().notices.find(([, notice]) => notice.tool_name === read)![1].status, 'detected')
  assert.equal(progress.snapshot().facts.find(fact => fact.tool === read)!.outcome, 'error:LOCAL_PATH_IS_DIRECTORY')
  assert.match(progress.summary(), /approval_rejected/u)
})

test('淘汰后恢复入口跨目录刷新保留，摘要与最终声明一致且不超过 32 项', async () => {
  const mcp = connection()
  const fillers: AgentTool[] = Array.from({ length: 40 }, (_, index) => identifyTool({ name: `fixture_${index}`, label: 'fixture',
    description: 'fixture', parameters: Type.Object({}), execute: async () => ({ content: [] }) }, termousToolSource, `termous.fixture.${index}`))
  const entries = [...mcp.tools, ...fillers]
  let discovery = new RuntimeToolDiscovery(entries, mcp.originalName, [])
  discovery.preload([])
  for (let i = 0; i < 40; i += 8) {
    discovery.loadNames(Array.from({ length: 8 }, (_, n) => `termous.fixture.${i + n}`))
    discovery.publish()
  }
  assert.equal(discovery.declaration(execute).status, 'discoverable')
  const result = await mcp.tools[0]!.execute('read', { path: 'target' })
  discovery.navigate(runtimeToolNavigation(read, result, [], true)!)
  const retained = discovery.retainedNames()
  discovery = new RuntimeToolDiscovery(entries, mcp.originalName, [])
  discovery.restoreNames(retained)
  const published = discovery.publish()
  assert(published.length <= 32)
  assert.equal(discovery.declaration(execute, published).status, 'declared')
  const progress = new RuntimeToolProgress()
  progress.observe(read, { path: 'target' }, result, true)
  assert.match(progress.summary(name => discovery.declaration(name, published)), /"name":"m_termous_dlocal_dcommands_dexecute","source":"local","status":"declared"/u)
  discovery.loadNames(['termous.fixture.0'])
  discovery.publish()
  assert.equal(discovery.declaration(execute).status, 'declared')
  assert.equal(discovery.declaration('termous.fixture.10').status, 'discoverable')
  assert.equal(discovery.declaration('termous.fixture.39').status, 'declared')
})
