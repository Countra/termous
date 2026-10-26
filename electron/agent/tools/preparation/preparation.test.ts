import assert from 'node:assert/strict'
import test from 'node:test'
import type { Tool } from '@modelcontextprotocol/client'
import { mapMCPTools } from '../mcpClientAdapter.ts'
import { bindRuntimeResourceTools } from '../runtimeResourceRouting.ts'
import { prepareBuiltinTools } from './index.ts'
import { PreparationSnapshots } from './identity.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

const string = { type: 'string' }
const integer = { type: 'integer' }
function definition(name: string, properties: Record<string, unknown>, required: string[] = [], readOnly = true): Tool {
  return { name, description: name, inputSchema: { type: 'object', properties: properties as Tool['inputSchema']['properties'], required, additionalProperties: false }, annotations: { readOnlyHint: readOnly } }
}
const desktop = { kind: 'desktop_session', session_id: 'desktop', connection_generation: 3, desktop_profile_id: 'profile', desktop_profile_name: 'Desktop', host_id: 'host', host_name: 'Host', protocol: 'rdp', bound_at: '2026-10-24T00:00:00Z' } satisfies RuntimeResourceBinding
const session = { id: 'desktop', profile_id: 'profile', host_id: 'host', protocol: 'rdp', connection_generation: 3, status: 'ready' }
const attachment = { id: 'attachment', session_id: 'desktop', connection_generation: 3, execution_generation: 4, state: 'ready' }
const get = definition('termous.desktops.get', { session_id: string, attachment_id: string, wait_ms: integer })
const attach = definition('termous.desktops.attach', { session_id: string, connection_generation: integer, client_request_id: string }, ['session_id', 'connection_generation', 'client_request_id'], false)
const click = definition('termous.desktops.pointer.click', { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, coordinate_space: string, x: integer, y: integer }, ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'x', 'y'], false)
const capture = definition('termous.desktops.capture', { attachment_id: string }, ['attachment_id'])
const control = definition('termous.desktops.control.acquire', { attachment_id: string, client_request_id: string }, ['attachment_id', 'client_request_id'], false)

function harness(definitions: Tool[], respond: (name: string, args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, bindings: RuntimeResourceBinding[] = [], failPersist = false) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const persisted = new Map<string, PreparedCall>()
  const phases: string[] = []
  const mapped = mapMCPTools(definitions, async (tool, args) => {
    calls.push({ name: tool.name, args: structuredClone(args) })
    const output = await respond(tool.name, args)
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, ...(output.error ? { isError: true } : {}) }
  })
  const mcp = { ...mapped, originalName: (name: string) => mapped.originalNames.get(name) ?? null, close: async () => {}, readOnly: (name: string) => definitions.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true }
  const tools = prepareBuiltinTools({ ...mcp, tools: bindRuntimeResourceTools(mcp, bindings) }, {
    runID: 'run', generation: 2, bindings,
    progress: (_id, _name, phase) => { phases.push(phase) },
    persist: async (record) => { if (failPersist) throw new Error('disk'); persisted.set(`${record.tool_call_id}:${record.step}`, structuredClone(record)) },
    lookup: async (id, step) => persisted.get(`${id}:${step}`),
  })
  return { calls, persisted, mapped, phases, tool: (name: string) => tools.find((tool) => mcp.originalName(tool.name) === name)!,
    run: (name: string, id: string, args: Record<string, unknown>) => tools.find((tool) => mcp.originalName(tool.name) === name)!.execute(id, args),
  }
}
function output(result: AgentToolResult<unknown>) { assert.ok(isMCPToolDetails(result.details)); return result.details.result.structuredContent as Record<string, unknown> }

test('桌面只读查询自动选择唯一已连接目标，但不为查询创建连接', async () => {
  const list = definition('termous.desktops.list', {})
  const h = harness([get, list], (name) => name === list.name ? { sessions: [session] } : { session })
  assert.ok(output(await h.run(get.name, 'read', {})).session)
  assert.deepEqual(h.calls.map((v) => v.name), [list.name, get.name, get.name])
  assert.equal(h.calls[h.calls.length - 1]!.args.session_id, session.id)
  const ambiguous = harness([get, list], () => ({ sessions: [session, { ...session, id: 'other' }] }))
  assert.equal((output(await ambiguous.run(get.name, 'read', {})).error as { code: string }).code, 'AGENT_TARGET_SELECTION_REQUIRED')
  assert.equal(ambiguous.calls.length, 1)
})

test('绑定桌面运行固定脚本只需业务参数，准备不申请即时授权', async () => {
  const start = definition('termous.desktop_workflows.runs.start', { script_id: string, version: integer, session_id: string, connection_generation: integer, client_request_id: string, parameters: { type: 'object' } }, ['script_id', 'version', 'client_request_id'], false)
  const read = definition('termous.desktop_workflows.get', { script_id: string }, ['script_id'])
  const h = harness([get, read, start], (name) => name === get.name ? { session } : name === read.name ? { detail: { script: { id: 'script', revision: 9 }, version: { number: 8 } } } : { run: { id: 'workflow', version: 8, state: 'preparing' } }, [desktop])
  const result = await h.run(start.name, 'call', { script_id: 'script', parameters: {} })
  assert.ok(output(result).run)
  assert.deepEqual(h.calls.map((v) => v.name), [read.name, get.name, start.name])
  assert.equal(h.calls[2].args.version, 8)
  assert.equal(h.calls[2].args.session_id, 'desktop')
  assert.equal(h.calls[2].args.connection_generation, 3)
  assert.match(String(h.calls[2].args.client_request_id), /^agt_[a-f0-9]{48}$/u)
})

test('截图后点击自动取得授权且保留模型观察的截图与桌面坐标', async () => {
  const h = harness([get, attach, capture, control, click], (name, args) => name === get.name ? args.session_id ? { session } : { attachment }
    : name === attach.name ? { attachment } : name === capture.name ? { capture: { screenshot_id: 'shot' } }
      : name === control.name ? { control: { attachment: { ...attachment, grant: { id: 'grant' } } } } : { operation: { state: 'accepted' } }, [desktop])
  await h.run(capture.name, 'observe', {})
  await h.run(click.name, 'click', { screenshot_id: 'shot', coordinate_space: 'desktop', x: 420, y: 260 })
  const input = h.calls[h.calls.length - 1]!.args
  assert.equal(input.grant_id, 'grant')
  assert.equal(input.attachment_id, 'attachment')
  assert.equal(input.screenshot_id, 'shot')
  assert.equal(input.x, 420)
  assert.equal(h.calls.filter((v) => v.name === capture.name).length, 1)
})

test('未知或历史截图要求重新观察，不悄悄截图后继续旧坐标', async () => {
  const h = harness([get, attach, capture, control, click], () => ({}), [desktop])
  const result = output(await h.run(click.name, 'click', { screenshot_id: 'old', x: 10, y: 20 }))
  assert.equal((result.error as { code: string }).code, 'AGENT_OBSERVATION_REQUIRED')
  assert.equal(h.calls.length, 0)
})

test('审批终止立即返回用户处理，不重复申请或派发输入', async () => {
  for (const state of ['rejected', 'expired', 'cancelled']) {
    const h = harness([get, attach, capture, control, click], (name, args) => name === get.name ? args.session_id ? { session } : { attachment }
      : name === attach.name ? { attachment } : name === capture.name ? { capture: { screenshot_id: 'shot' } }
        : { control: { approval: { id: 'approval', state } } }, [desktop])
    await h.run(capture.name, 'observe', {})
    const result = output(await h.run(click.name, 'click', { screenshot_id: 'shot', x: 10, y: 20 }))
    const error = result.error as { code: string; execution: { recovery: { kind: string } } }
    assert.equal(error.code, 'AGENT_CONTROL_APPROVAL_STOPPED')
    assert.equal(error.execution.recovery.kind, 'user_action')
    assert.equal(h.calls.filter((call) => call.name === control.name).length, 1)
    assert.equal(h.calls.filter((call) => call.name === click.name).length, 0)
  }
})

test('人工审批未完成时调用保持等待，批准后只派发一次原点击', async () => {
  let approve!: (value: Record<string, unknown>) => void
  const approval = new Promise<Record<string, unknown>>((resolve) => { approve = resolve })
  let request!: () => void
  const requested = new Promise<void>((resolve) => { request = resolve })
  const h = harness([get, attach, capture, control, click], (name, args) => name === get.name ? args.session_id ? { session } : { attachment }
    : name === attach.name ? { attachment } : name === capture.name ? { capture: { screenshot_id: 'shot' } }
      : name === control.name ? (request(), approval) : { operation: { state: 'accepted' } }, [desktop])
  await h.run(capture.name, 'observe', {})
  let completed = false
  const pending = h.run(click.name, 'click', { screenshot_id: 'shot', x: 10, y: 20 }).then((result) => { completed = true; return result })
  await requested
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(h.phases[h.phases.length - 1], 'waiting')
  assert.equal(h.calls.filter((v) => v.name === click.name).length, 0)
  approve({ control: { approval: { state: 'approved' }, attachment: { ...attachment, grant: { id: 'grant' } } } })
  assert.ok(output(await pending).operation)
  assert.equal(h.calls.filter((v) => v.name === click.name).length, 1)
  assert.equal(h.calls[h.calls.length - 1]!.args.screenshot_id, 'shot')
  assert.equal(h.phases[h.phases.length - 1], 'executing')
})

test('授权获取失败保留原错误，已完成但失效的授权要求重读，不再等待批准', async () => {
  for (const state of ['dispatch_conflict', 'approved']) {
    const h = harness([get, attach, capture, control, click], (name, args) => name === get.name ? args.session_id ? { session } : { attachment }
      : name === attach.name ? { attachment } : name === capture.name ? { capture: { screenshot_id: 'shot' } }
        : { control: { approval: { id: 'approval', state, error_code: 'desktop_capability_unsupported', error_message: '执行端不支持安全交接' } } }, [desktop])
    await h.run(capture.name, 'observe', {})
    const result = output(await h.run(click.name, 'click', { screenshot_id: 'shot', x: 10, y: 20 }))
    const error = result.error as { code: string; message: string; execution: { dispatch: string; recovery: { kind: string } } }
    assert.equal(error.code, state === 'approved' ? 'AGENT_CONTROL_GRANT_UNAVAILABLE' : 'desktop_capability_unsupported')
    assert.equal(error.execution.recovery.kind, state === 'approved' ? 'reread' : 'user_action')
    assert.equal(error.execution.dispatch, 'not_started')
    if (state === 'dispatch_conflict') assert.equal(error.message, '执行端不支持安全交接')
    assert.equal(h.calls.filter((v) => v.name === control.name).length, 1)
    assert.equal(h.calls.filter((v) => v.name === click.name).length, 0)
  }
})

test('传输恢复复用身份，两次明确的新操作使用不同身份', async () => {
  const create = definition('termous.snippets.create', { name: string, command: string, client_request_id: string }, ['name', 'command', 'client_request_id'], false)
  const h = harness([create], () => ({ snippet: { id: 'snippet', updated_at: 'time' } }))
  const args = { name: 'Example', command: 'pwd' }
  await h.run(create.name, 'call1', args)
  await h.run(create.name, 'call1', args)
  await h.run(create.name, 'call2', args)
  assert.equal(h.calls[0].args.client_request_id, h.calls[1].args.client_request_id)
  assert.notEqual(h.calls[0].args.client_request_id, h.calls[2].args.client_request_id)
  assert.ok(!JSON.stringify([...h.persisted.values()]).includes('pwd'))
})

test('准备记录保存失败阻止实际写入', async () => {
  const create = definition('termous.snippets.create', { name: string, client_request_id: string }, ['name', 'client_request_id'], false)
  const h = harness([create], () => ({}), [], true)
  await assert.rejects(h.run(create.name, 'call', { name: 'Example' }), /disk/u)
  assert.equal(h.calls.length, 0)
})

test('缺少修订要求先读取，已读修订冲突不自动覆盖', async () => {
  const read = definition('termous.snippets.get', { snippet_id: string }, ['snippet_id'])
  const update = definition('termous.snippets.update', { snippet_id: string, name: string, client_request_id: string, expected_updated_at: string }, ['snippet_id', 'name', 'client_request_id', 'expected_updated_at'], false)
  const h = harness([read, update], (name) => name === read.name ? { snippet: { id: 'snippet', updated_at: 'before' } } : { error: { code: 'CONFLICT' } })
  assert.equal((output(await h.run(update.name, 'first', { snippet_id: 'snippet', name: 'new' })).error as { code: string }).code, 'AGENT_READ_REQUIRED')
  await h.run(read.name, 'read', { snippet_id: 'snippet' })
  await h.run(update.name, 'update', { snippet_id: 'snippet', name: 'new' })
  assert.equal(h.calls[h.calls.length - 1]!.args.expected_updated_at, 'before')
  assert.equal(h.calls.length, 2)
})

test('计划任务准备保留读取到的哈希修订，原调用重试不采用新修订', async () => {
  const read = definition('termous.remoteops.crontab.get', { session_id: string }, ['session_id'])
  const create = definition('termous.remoteops.crontab.jobs.create', { session_id: string, command: string, expected_revision: string, client_request_id: string }, ['session_id', 'command', 'expected_revision', 'client_request_id'], false)
  const inspect = definition('termous.sessions.get', { session_id: string }, ['session_id'])
  let revision = 'a1'.repeat(32)
  const h = harness([read, create, inspect], (name) => name === inspect.name ? { session: { id: 'ssh', status: 'connected', phase: 'ready' } }
    : name === read.name ? { crontab: { revision } } : { approval: { state: 'pending' } })
  await h.run(read.name, 'read', { session_id: 'ssh' })
  const args = { session_id: 'ssh', command: 'printf fixture' }
  await h.run(create.name, 'create', args)
  assert.equal(h.persisted.get('create:dispatch')?.values.expected_revision, revision)
  revision = 'b2'.repeat(32)
  await h.run(read.name, 'reread', { session_id: 'ssh' })
  await h.run(create.name, 'create', args)
  const mutations = h.calls.filter((call) => call.name === create.name)
  assert.equal(mutations.length, 2)
  assert.deepEqual(mutations[1]!.args, mutations[0]!.args)
  assert.equal(mutations[0]!.args.expected_revision, 'a1'.repeat(32))
  assert.ok(!JSON.stringify([...h.persisted.values()]).includes(args.command))
})

test('多个文件会话返回候选，禁止猜测目标', async () => {
  const list = definition('termous.files.sessions.list', {})
  const stat = definition('termous.files.stat', { file_session_id: string, expected_connection_generation: integer, path: string }, ['file_session_id', 'expected_connection_generation', 'path'])
  const h = harness([list, stat], () => ({ sessions: ['one', 'two'].map((id) => ({ id, owned_by_client: true, status: 'connected' })) }))
  const result = output(await h.run(stat.name, 'stat', { path: '/tmp/example' }))
  assert.equal((result.error as { code: string }).code, 'AGENT_TARGET_SELECTION_REQUIRED')
  assert.equal(h.calls.length, 1)
})

test('内置 Schema 隐藏机械身份，外部完整 Schema 保持原样', () => {
  const h = harness([click], () => ({}))
  const original = h.mapped.tools[0].parameters as { required: string[] }
  const simplified = h.tool(click.name).parameters as { required: string[]; properties: Record<string, unknown> }
  assert.ok(original.required.includes('grant_id'))
  assert.ok(!('grant_id' in simplified.properties))
  assert.ok(!('client_request_id' in simplified.properties))
  assert.ok(simplified.required.includes('screenshot_id'))
})

test('准备快照有界且不存正文', () => {
  const cache = new PreparationSnapshots()
  for (let i = 0; i < 1000; i++) cache.remember(`revision:${i}`, { version: i })
  assert.equal(cache.read('revision:0'), undefined)
  assert.equal(cache.read('revision:935'), undefined)
  assert.deepEqual(cache.read('revision:936'), { version: 936 })
})

test('重连允许已断开的所属文件会话，不创建另一条连接', async () => {
  const get = definition('termous.files.sessions.get', { file_session_id: string }, ['file_session_id'])
  const reconnect = definition('termous.files.sessions.reconnect', { file_session_id: string, client_request_id: string }, ['file_session_id', 'client_request_id'], false)
  const h = harness([get, reconnect], (name) => ({ session: { id: 'files', owned_by_client: true, status: name === get.name ? 'disconnected' : 'connecting', connection_generation: 4 } }))
  assert.ok(output(await h.run(reconnect.name, 'reconnect', { file_session_id: 'files' })).session)
  assert.deepEqual(h.calls.map((c) => c.name), [get.name, reconnect.name])
})

test('编辑重传固定初次读取修订，即使后续读取已经改变', async () => {
  let revision = 'before'
  const read = definition('termous.snippets.get', { snippet_id: string }, ['snippet_id'])
  const update = definition('termous.snippets.update', { snippet_id: string, name: string, client_request_id: string, expected_updated_at: string }, ['snippet_id', 'name', 'client_request_id', 'expected_updated_at'], false)
  const h = harness([read, update], (name) => name === read.name ? { snippet: { id: 'snippet', updated_at: revision } } : { error: { code: 'CONFLICT' } })
  await h.run(read.name, 'read1', { snippet_id: 'snippet' })
  await h.run(update.name, 'edit', { snippet_id: 'snippet', name: 'new' })
  revision = 'after'
  await h.run(read.name, 'read2', { snippet_id: 'snippet' })
  await h.run(update.name, 'edit', { snippet_id: 'snippet', name: 'new' })
  assert.equal(h.calls[h.calls.length - 1]!.args.expected_updated_at, 'before')
})

test('输入响应丢失只查询原操作，跨执行代次不会恢复旧授权', async () => {
  const operation = definition('termous.desktops.operations.get', { attachment_id: string, client_request_id: string }, ['attachment_id', 'client_request_id'])
  const h = harness([get, attach, capture, control, click, operation], (name, args) => {
    if (name === get.name) return args.session_id ? { session } : { attachment }
    if (name === attach.name) return { attachment }
    if (name === capture.name) return { capture: { screenshot_id: 'shot' } }
    if (name === control.name) return { control: { attachment: { ...attachment, grant: { id: 'grant' } } } }
    if (name === click.name) throw new Error('lost response')
    return { operation: { id: args.client_request_id, state: 'uncertain' } }
  }, [desktop])
  await h.run(capture.name, 'observe', {})
  const lost = output(await h.run(click.name, 'click', { screenshot_id: 'shot', x: 1, y: 1 }))
  assert.equal((lost.error as { code: string }).code, 'desktop_input_uncertain')
  await h.run(operation.name, 'query', { tool_call_id: 'click' })
  assert.equal(h.calls.filter((v) => v.name === click.name).length, 1)
  const prepared = h.persisted.get('click:dispatch')!
  assert.equal(h.calls[h.calls.length - 1]!.args.client_request_id, prepared.request_id)
  prepared.generation = 1
  const before = h.calls.length
  const stale = output(await h.run(operation.name, 'query-old', { tool_call_id: 'click' }))
  assert.equal((stale.error as { code: string }).code, 'AGENT_OPERATION_OUTCOME_UNAVAILABLE')
  assert.equal(h.calls.length, before)
  prepared.operation_result = { id: prepared.request_id, state: 'accepted' }
  const completed = output(await h.run(operation.name, 'query-receipt', { tool_call_id: 'click' }))
  assert.equal((completed.operation as { state: string }).state, 'accepted')
  assert.equal(h.calls.length, before)
})

test('SSH 精确绑定自动补充会话，命令与新请求身份保持显式且独立', async () => {
  const read = definition('termous.sessions.get', { session_id: string }, ['session_id'])
  const dispatch = definition('termous.commands.dispatch', { session_ids: { type: 'array', items: string }, command: string, client_request_id: string }, ['session_ids', 'command', 'client_request_id'], false)
  const binding = { kind: 'ssh_session', session_id: 'ssh', ssh_profile_id: 'profile', host_id: 'host', host_name: 'Host', platform: 'linux', bound_at: 'now' } satisfies RuntimeResourceBinding
  const h = harness([read, dispatch], (name) => name === read.name ? { session: { id: 'ssh', host_id: 'host', ssh_profile_id: 'profile', status: 'connected', phase: 'ready' } } : { task: { id: 'task' } }, [binding])
  await h.run(dispatch.name, 'dispatch', { command: 'pwd' })
  assert.deepEqual(h.calls[1]!.args.session_ids, ['ssh'])
  assert.equal(h.calls[1]!.args.command, 'pwd')
  assert.equal(h.calls.length, 2)
})

test('文件计划只复用完全相同的路径与删除范围，修改参数必须重新预览', async () => {
  const list = definition('termous.files.sessions.list', {})
  const get = definition('termous.files.sessions.get', { file_session_id: string }, ['file_session_id'])
  const fields = { file_session_id: string, expected_connection_generation: integer, path: string, recursive: { type: 'boolean' } }
  const preview = definition('termous.files.delete.preview', fields, ['file_session_id', 'expected_connection_generation', 'path'])
  const start = definition('termous.files.delete.start', { ...fields, expected_plan_hash: string, client_request_id: string }, ['file_session_id', 'expected_connection_generation', 'path', 'expected_plan_hash', 'client_request_id'], false)
  const session = { id: 'files', owned_by_client: true, status: 'connected', connection_generation: 2 }
  const h = harness([list, get, preview, start], (name) => name === list.name ? { sessions: [session] } : name === get.name ? { session } : name === preview.name ? { preview: { plan_hash: 'plan' } } : { operation: { id: 'delete' } })
  await h.run(preview.name, 'preview', { path: '/sandbox/old', recursive: false })
  await h.run(start.name, 'delete', { path: '/sandbox/old', recursive: false })
  assert.equal(h.calls[h.calls.length - 1]!.args.expected_plan_hash, 'plan')
  const different = output(await h.run(start.name, 'other', { path: '/sandbox/new', recursive: false }))
  assert.equal((different.error as { code: string }).code, 'AGENT_PREVIEW_REQUIRED')
  assert.equal(h.calls.filter((v) => v.name === start.name).length, 1)
})

test('片段分组重排携带读到的修订，重传不使用更新后的分组修订', async () => {
  const list = definition('termous.snippets.groups.list', {})
  const reorder = definition('termous.snippets.groups.reorder', { client_request_id: string, items: { type: 'array', items: { type: 'object', properties: { id: string, sort_order: integer, expected_updated_at: string }, required: ['id', 'sort_order', 'expected_updated_at'] } } }, ['items', 'client_request_id'], false)
  const h = harness([list, reorder], (name) => name === list.name ? { groups: { items: [{ id: 'group', updated_at: 'old' }] } } : { completed: true })
  await h.run(list.name, 'list', {})
  await h.run(reorder.name, 'order', { items: [{ id: 'group', sort_order: 3 }] })
  await h.run(reorder.name, 'order', { items: [{ id: 'group', sort_order: 3 }] })
  assert.deepEqual(h.calls[h.calls.length - 1]!.args.items, [{ id: 'group', sort_order: 3, expected_updated_at: 'old' }])
})


test('本机截图准备通过精确来源发现附着，不查询或建立协议连接', async () => {
  const target = { kind: 'host_desktop' as const, instance_id: 'core', host: { id: 'screen', kind: 'screen' as const, title: 'Screen', generation: 1 } }
  const binding = { kind: 'host_desktop' as const, desktop_target: target, host_name: '' as const, bound_at: desktop.bound_at }
  const sources = definition('termous.desktops.sources', { kind: string }, ['kind'])
  const hostAttach = definition(attach.name, { target: { type: 'object' }, client_request_id: string }, ['target', 'client_request_id'], false)
  const h = harness([sources, hostAttach, get, capture], name => name === sources.name ? { sources: [{ target }] }
    : name === hostAttach.name ? { attachment: { id: 'host-a', target, state: 'ready' } } : { capture: { screenshot_id: 'shot' } }, [binding])
  assert.ok(output(await h.run(capture.name, 'host-shot', {})).capture)
  assert.deepEqual(h.calls.map(value => value.name), [sources.name, hostAttach.name, capture.name])
  assert.deepEqual(h.calls[1]!.args.target, target)
  assert.equal(h.calls[1]!.args.session_id, undefined)
})
