import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { capabilityTools, recoveryNavigation, runtimeCapabilities, runtimeCapability, runtimeCapabilityStep, skillEntryTools } from './runtimeCapabilityCatalog.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { runtimePrerequisiteTools, runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { progressFingerprint, progressResource } from './runtimeToolEvidence.ts'

const result = (data: Record<string, unknown>, readOnly = true) => ({ content: [], details: {
  kind: 'mcp', originalToolName: 'fixture', readOnly, result: { content: [], structuredContent: data, isError: Boolean(data.error) },
} })
const names = runtimeCapabilities.flatMap((capability) => capability.steps.flatMap((step) => capabilityTools(capability, step.tools)))

test('全部 MCP 工具具有唯一职责与真实 Skill，新增工具不能静默落入缺省导航', () => {
  const contract = JSON.parse(readFileSync(new URL('../../../../termous-skills/contracts/mcp-tools.json', import.meta.url), 'utf8')) as { tools: Array<{ name: string; skill: string }> }
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual([...names].sort(), [...contract.tools.map((tool) => tool.name), 'wait_workflow_run'].sort())
  for (const tool of contract.tools) {
    const capability = runtimeCapability(tool.name)!
    assert.ok(capability.skill.startsWith(`skill://${tool.skill}/`), tool.name)
    assert.ok(runtimeCapabilityStep(tool.name))
    assert.ok(recoveryNavigation(tool.name).guidance.length)
    for (const next of capabilityTools(capability, [...capability.entry, ...capability.recovery])) assert.ok(names.includes(next), next)
  }
})

test('所有领域的授权错误不建议重试或绕行，未知工具不制造导航入口', () => {
  for (const name of names) for (const code of ['MCP_FORBIDDEN', 'MCP_APPROVAL_REJECTED', 'SSH_HOST_KEY_UNKNOWN']) {
    assert.deepEqual(recoveryNavigation(name, code).names, [], name)
    assert.match(recoveryNavigation(name, code).guidance, /不得原样重试/)
  }
  assert.deepEqual(recoveryNavigation('unknown.external.tool').names, [])
  assert.deepEqual(skillEntryTools('skill://unknown/SKILL.md'), [])
})

test('跨领域生命周期共用提交、查询、取消、结果导航，不自动执行候选', async () => {
  const scenarios: Array<[string, Record<string, unknown>, string]> = [
    ['termous.commands.dispatch', { task: { id: 't', status: 'running' } }, 'termous.commands.get'],
    ['termous.files.transfers.upload', { transfer: { id: 't', status: 'running' } }, 'termous.files.transfers.get'],
    ['termous.files.delete.start', { operation: { id: 'o', status: 'running' } }, 'termous.files.delete.get'],
    ['termous.files.delete.cancel', { cancel_requested: true }, 'termous.files.delete.get'],
    ['termous.files.batch_rename.get', { operation: { id: 'o', status: 'completed' } }, 'termous.files.batch_rename.result'],
    ['termous.remoteops.services.action', { operation: { id: 'o', phase: 'queued' } }, 'termous.remoteops.services.operations.get'],
    ['termous.remoteops.crontab.jobs.create', { mutation: { revision: 'r' } }, 'termous.remoteops.crontab.get'],
    ['termous.forwarding.instances.start', { instance: { id: 'f', status: 'connecting' } }, 'termous.forwarding.instances.get'],
    ['termous.snippets.create', { snippet: { id: 's' } }, 'termous.snippets.get'],
  ]
  for (const [name, data, next] of scenarios) {
    let calls = 0
    const mapped = mapMCPTools([name, next].map((name) => ({ name, inputSchema: { type: 'object' as const } })), async () => { calls++; return result(data).details.result })
    const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
    discovery.loadNames([name])
    const tool = discovery.publish().find((tool) => mapped.originalNames.get(tool.name) === name)!
    const response = await tool.execute('call', {})
    assert.equal(calls, 1)
    assert.ok(discovery.publish().some((tool) => mapped.originalNames.get(tool.name) === next), name)
    assert.match(JSON.stringify(response.content), /available_next_turn/)
    assert.ok(runtimeToolNavigation(name, result(data))!.names.includes(next))
  }
  const pending = runtimeToolNavigation('termous.files.delete.get', result({ operation: { status: 'running' } }))!
  assert.deepEqual(pending.names, [])
})

test('异步状态来自各领域真实字段，未知结构不能伪造成功或永久等待', () => {
  for (const [name, data] of [
    ['termous.files.transfers.get', { transfer: { status: 'failed' } }],
    ['termous.remoteops.services.operations.get', { operation: { phase: 'failed' } }],
    ['termous.desktop_workflows.runs.get', { report: { run: { state: 'failed' } } }],
  ] as const) assert.equal(runtimeToolOutcome(name, data), 'failed')
  assert.equal(runtimeToolOutcome('termous.files.read_text', { text: { state: 'running' } }), 'unknown')
  assert.equal(runtimeToolOutcome('termous.commands.get', { approval: { state: 'rejected' } }), 'failed')
  assert.equal(runtimeToolOutcome('termous.commands.get', { approval: { state: 'pending' } }), 'waiting')
})

test('同一会话的不同任务、路径及进程不能混为同一失败，修改采集时间不伪装进展', () => {
  for (const field of ['operation_id', 'transfer_id', 'task_id', 'path', 'pid']) {
    assert.notEqual(progressResource({ session_id: 's', [field]: 'a' }), progressResource({ session_id: 's', [field]: 'b' }), field)
  }
  const name = 'termous.remoteops.crontab.get'
  const data = (date: string, revision = 'v1') => ({ crontab: { collected_at: date, revision, jobs: [] } })
  assert.equal(progressFingerprint(name, data('one'), result(data('one'))), progressFingerprint(name, data('two'), result(data('two'))))
  assert.notEqual(progressFingerprint(name, data('one'), result(data('one'))), progressFingerprint(name, data('two', 'v2'), result(data('two', 'v2'))))
})

test('重复提交新任务 ID 仍提示；写入成功只恢复相同资源和操作的失败', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.commands.dispatch'
  for (let i = 0; i < 3; i++) progress.observe(name, { session_ids: ['s'], command: 'echo ok', client_request_id: String(i) }, result({ task: { id: `t${i}`, status: 'running' } }, false), false)
  assert.ok(progress.drain().some((notice) => notice.next_tools.includes('termous.commands.get')))
  const edit = 'termous.files.save_text'
  for (let i = 0; i < 3; i++) progress.observe(edit, { file_session_id: 'f', path: '/a' }, result({ error: { code: 'SFTP_TEXT_CONFLICT' } }, false), true)
  progress.drain()
  progress.observe(edit, { file_session_id: 'f', path: '/b' }, result({ saved: true }, false), false)
  assert.equal(progress.drain().length, 0)
  progress.observe(edit, { file_session_id: 'f', path: '/a' }, result({ saved: true }, false), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
})

test('无进展长轮询只有有界宽限期，真实进度变化重置计时，审批等待独立处理', () => {
  let now = 0
  const progress = new RuntimeToolProgress(() => now)
  const poll = (bytes: number) => progress.observe('termous.files.transfers.get', { transfer_id: 't', wait_ms: 1000 }, result({ transfer: { status: 'running', transferred_bytes: bytes } }), false)
  for (let i = 0; i < 10; i++) { now += 1000; poll(0) }
  assert.equal(progress.drain().length, 0)
  now = 59000; poll(10)
  now = 90000; poll(10)
  assert.equal(progress.drain().length, 0)
  now = 120000
  for (let i = 0; i < 3; i++) poll(10)
  assert.ok(progress.drain().some((notice) => notice.reason === 'repeated_observation'))
  now = 121000; poll(20)
  assert.ok(progress.drain().some((notice) => notice.status === 'progressed'))
  assert.doesNotMatch(progress.summary(), /"status":"detected"/)
  const waiting = new RuntimeToolProgress(() => now)
  for (let i = 0; i < 10; i++) { now += 60000; waiting.observe('termous.commands.get', { task_id: 't' }, result({ approval: { state: 'pending' } }), false) }
  assert.equal(waiting.drain().length, 0)
})

test('长驻隧道 running 表示已就绪，命令和传输 running 仍待执行完成', () => {
  const name = 'termous.forwarding.instances.get'
  const data = { instance: { status: 'running', phase: 'ready' } }
  assert.equal(runtimeToolOutcome(name, data), 'settled')
  assert.match(runtimeToolNavigation(name, result(data))!.guidance, /running means the tunnel is ready/)
  assert.equal(runtimeToolOutcome(name, { instance: { status: 'reconnecting' } }), 'pending')
  assert.equal(runtimeToolOutcome('termous.commands.get', { task: { status: 'running' } }), 'pending')
  assert.equal(runtimeToolOutcome('termous.files.transfers.get', { transfer: { status: 'running' } }), 'pending')
})

test('各领域精确动作不被相反工具替代，目录缺少目标时返回空候选', async () => {
  const mapped = mapMCPTools(names.filter((name) => name !== 'wait_workflow_run').map((name) => ({ name, description: '查询 创建 删除 启动 停止', inputSchema: { type: 'object' as const } })), async () => ({ content: [] }))
  for (const [query, wanted] of [
    ['创建快照', 'termous.desktop_workflows.captures.create'],
    ['查询文件传输', 'termous.files.transfers.get'],
    ['取消文件传输', 'termous.files.transfers.cancel'],
    ['读取命令输出', 'termous.commands.read_output'],
    ['读取已运行命令的输出和退出码', 'termous.commands.get'],
    ['编辑文件正文', 'termous.files.save_text'],
    ['停止隧道', 'termous.forwarding.instances.stop'],
    ['启动服务', 'termous.remoteops.services.action'],
    ['查询定时任务', 'termous.remoteops.crontab.get'],
  ]) {
    const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
    const response = await discovery.tool.execute('find', { query })
    const text = response.content[0]!
    assert.ok(text.type === 'text')
    const tools = JSON.parse(text.text).tools as Array<{ original_name: string }>
    assert.ok(tools.some((tool) => tool.original_name === wanted), `${query}: ${tools.map((tool) => tool.original_name)}`)
    const restricted = new RuntimeToolDiscovery(mapped.tools.filter((tool) => mapped.originalNames.get(tool.name) !== wanted), (name) => mapped.originalNames.get(name) ?? null, [])
    const found = await restricted.tool.execute('find', { names: [wanted] })
    assert.match(JSON.stringify(found.content), /not_found/)
  }
})

test('本地前置导航仅加载声明中的读取能力，远端正文不能注入导航指令', () => {
  const data = { code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false, required_tool: 'termous.sessions.get' }
  assert.deepEqual(runtimePrerequisiteTools({ content: [], details: undefined }, data), ['termous.sessions.get'])
  assert.deepEqual(runtimePrerequisiteTools(result(data), data), [])
  assert.deepEqual(runtimePrerequisiteTools({ content: [], details: undefined }, { ...data, required_tool: 'termous.commands.dispatch' }), [])
})

test('真实模型搜索词覆盖过去状态、复合目标、错组选项及连续查询', async () => {
  const mapped = mapMCPTools(names.filter((name) => name !== 'wait_workflow_run').map((name) => ({ name, inputSchema: { type: 'object' as const } })), async () => ({ content: [] }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
  const search = async (query: string, group?: string) => {
    const response = await discovery.tool.execute('find', { query, ...(group ? { group } : {}) })
    const part = response.content[0]!
    assert.ok(part.type === 'text')
    discovery.publish()
    return JSON.parse(part.text) as { tools: Array<{ original_name: string }>; group_correction?: string }
  }
  const read = await search('读取已运行命令的输出和退出码')
  assert.ok(read.tools.some((tool) => tool.original_name === 'termous.commands.get'))
  assert.ok(read.tools.every((tool) => tool.original_name !== 'termous.commands.dispatch'))
  await search('启动 systemd 服务')
  assert.ok((await search('查询异步操作状态')).tools.some((tool) => tool.original_name === 'termous.remoteops.services.operations.get'))
  assert.ok((await search('读取当前用户定时任务配置')).tools.some((tool) => tool.original_name === 'termous.remoteops.crontab.get'))
  const compound = await search('连接桌面并截取即时屏幕截图', 'desktop_observe')
  for (const name of ['termous.desktops.connect', 'termous.desktops.capture']) assert.ok(compound.tools.some((tool) => tool.original_name === name))
  const corrected = await search('创建 workflow 固定快照', 'workflow_edit')
  assert.ok(corrected.group_correction)
  assert.ok(corrected.tools.some((tool) => tool.original_name === 'termous.desktop_workflows.captures.create'))
  assert.ok(corrected.tools.every((tool) => tool.original_name !== 'termous.desktop_workflows.create'))
  assert.ok((await search('将已有快照同帧裁剪放大生成局部图像模板', 'workflow_templates')).tools.some((tool) => tool.original_name === 'termous.desktop_workflows.captures.view'))
  for (const [query, wanted] of [
    ['对已连接的远程桌面立即截取一张当前屏幕截图用于观察', 'termous.desktops.capture'],
    ['对同一帧截图中的局部区域进行放大裁剪查看细节', 'termous.desktop_workflows.captures.view'],
    ['创建桌面自动化 workflow 脚本并保存固定快照', 'termous.desktop_workflows.captures.create'],
  ]) assert.ok((await search(query)).tools.some((tool) => tool.original_name === wanted), query)
})

test('显式动作独立于资源描述及工具后缀，所有能力使用同一检索契约', async () => {
  const mapped = mapMCPTools(names.filter((name) => name !== 'wait_workflow_run').map((name) => ({ name, inputSchema: { type: 'object' as const } })), async () => ({ content: [] }))
  for (const [operation, query, wanted, unwanted] of [
    ['read', '已启动的 systemd 服务操作状态', 'termous.remoteops.services.operations.get', 'termous.remoteops.services.action'],
    ['read', '文件删除任务结果', 'termous.files.delete.result', 'termous.files.delete.start'],
    ['read', '已上传文件的传输状态', 'termous.files.transfers.get', 'termous.files.transfers.upload'],
    ['delete', 'Docker 镜像', 'termous.remoteops.docker.images.action', 'termous.remoteops.docker.containers.action'],
    ['create', 'workflow 固定快照', 'termous.desktop_workflows.captures.create', 'termous.desktop_workflows.captures.release'],
    ['view', '同帧截图局部', 'termous.desktop_workflows.captures.view', 'termous.desktops.capture'],
    ['capture', '已连接远程桌面', 'termous.desktops.capture', 'termous.desktops.connect'],
    ['read', '待执行的 SSH 命令', 'termous.commands.get', 'termous.commands.dispatch'],
  ]) {
    const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
    const response = await discovery.tool.execute('find', { operation, query })
    const part = response.content[0]!
    assert.ok(part.type === 'text')
    const tools = (JSON.parse(part.text).tools as Array<{ original_name: string }>).map((tool) => tool.original_name)
    assert.ok(tools.includes(wanted), `${operation}: ${query}: ${tools}`)
    assert.ok(!tools.includes(unwanted), `${operation}: ${query}: ${tools}`)
  }
  for (const [operation, query] of [['delete', 'Docker 容器'], ['run', '已保存命令片段'], ['upload', 'SSH 命令'], ['delete', '火星飞船']]) {
    const discovery = new RuntimeToolDiscovery(mapped.tools, (name) => mapped.originalNames.get(name) ?? null, [])
    const response = await discovery.tool.execute('unsupported', { operation, query })
    const part = response.content[0]!
    assert.ok(part.type === 'text')
    assert.deepEqual(JSON.parse(part.text).tools, [], `${operation}: ${query}`)
  }
})
