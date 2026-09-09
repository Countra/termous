import assert from 'node:assert/strict'
import test from 'node:test'
import { Compile } from 'typebox/compile'
import type { Tool as MCPTool } from '@modelcontextprotocol/client'
import { mapMCPTools, type AgentMCPConnection } from './mcpClientAdapter.ts'
import { bindRuntimeResourceTools } from './runtimeResourceRouting.ts'
import type { RuntimeResourceBinding } from './workerCoreClient.ts'

const ssh: RuntimeResourceBinding = {
  kind: 'ssh_session', session_id: 'ses_new', host_id: 'host_new', ssh_profile_id: 'ssh_new',
  host_name: '不可信名称', platform: 'linux', bound_at: '2026-09-09T14:32:55Z',
}
const file: RuntimeResourceBinding = {
  kind: 'file_profile', file_access_profile_id: 'file_other', host_id: 'host_other', ssh_profile_id: 'ssh_other',
  file_access_profile_name: '文件配置', host_name: '文件主机', engine: 'sftp', bound_at: '2026-09-09T14:32:55Z',
}

function fixture(name = 'termous.commands.dispatch', field = 'session_ids', optional = false, schema?: MCPTool['inputSchema']) {
  const calls: Record<string, unknown>[] = []
  const definition: MCPTool = {
    name, inputSchema: schema ?? {
      type: 'object', properties: {
        [field]: field === 'session_ids' ? { type: 'array', items: { type: 'string' } } : { type: 'string' },
        command: { type: 'string' }, client_request_id: { type: 'string' },
      }, required: optional ? [] : [field], additionalProperties: false,
    },
  }
  const mapped = mapMCPTools([definition], async (_tool, args) => {
    calls.push(args)
    return { content: [{ type: 'text', text: '已执行' }] }
  })
  const mcp: AgentMCPConnection = {
    tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {},
  }
  return { calls, mcp, definition }
}

test('旧 SSH 与混合目标在 MCP 前拒绝，错误说明当前目标且不包含展示字段', async () => {
  const { mcp, calls } = fixture()
  const tool = bindRuntimeResourceTools(mcp, [ssh, file])[0]!
  for (const session_ids of [['ses_old'], ['ses_new', 'ses_old'], ['ses_new', 'ses_new'], []]) {
    const args = { session_ids, command: 'ls /root', client_request_id: 'current_request' }
    const original = structuredClone(args)
    const check = (error: unknown) => {
      assert.ok(error instanceof Error)
      const detail = JSON.parse(error.message)
      assert.equal(detail.code, 'AGENT_RESOURCE_BINDING_MISMATCH')
      assert.equal(detail.dispatched, false)
      assert.deepEqual(detail.expected_arguments, { session_ids: ['ses_new'] })
      assert.equal(detail.resource.session_id, 'ses_new')
      assert.doesNotMatch(error.message, /不可信名称|bound_at|ses_old/u)
      return true
    }
    assert.throws(() => tool.prepareArguments!(args), check)
    await assert.rejects(tool.execute('old_call', args), check)
    assert.deepEqual(args, original)
  }
  assert.equal(calls.length, 0)
  const args = { session_ids: ['ses_new'], command: 'ls /root', client_request_id: 'current_request' }
  const prepared = tool.prepareArguments!(args)
  const schema = Compile(tool.parameters)
  assert.equal(schema.Check(prepared), true)
  assert.equal(schema.Check({ ...args, session_ids: ['ses_old'] }), false)
  await tool.execute('new_call', prepared)
  assert.deepEqual(calls, [args])
  assert.equal(calls[0], args)
})

test('每轮重建目标约束且不污染原工具，解绑或仅文件绑定时不限制 SSH', async () => {
  const { mcp, calls } = fixture()
  const original = structuredClone(mcp.tools[0]!.parameters)
  const old = bindRuntimeResourceTools(mcp, [{ ...ssh, session_id: 'ses_old' }])[0]!
  const current = bindRuntimeResourceTools(mcp, [ssh])[0]!
  await old.execute('old_run', { session_ids: ['ses_old'] })
  await current.execute('new_run', { session_ids: ['ses_new'] })
  assert.match(JSON.stringify(current.parameters), /ses_new/u)
  assert.doesNotMatch(JSON.stringify(current.parameters), /ses_old/u)
  assert.deepEqual(mcp.tools[0]!.parameters, original)
  assert.equal(bindRuntimeResourceTools(mcp), mcp.tools)
  assert.equal(bindRuntimeResourceTools(mcp, [file]), mcp.tools)
  await bindRuntimeResourceTools(mcp, [file])[0]!.execute('unbound', { session_ids: ['ses_other', 'ses_another'] })
  assert.equal(calls.length, 3)
})

for (const name of ['termous.sessions.get', 'termous.sessions.close', 'termous.remoteops.processes.terminate',
  'termous.remoteops.crontab.jobs.update', 'termous.forwarding.instances.start']) {
  test(`${name} 的新目标遵循精确 SSH 绑定`, async () => {
    const optional = name === 'termous.forwarding.instances.start'
    const { mcp, calls } = fixture(name, 'session_id', optional)
    const tool = bindRuntimeResourceTools(mcp, [ssh])[0]!
    await assert.rejects(tool.execute('old', { session_id: 'ses_old' }), /AGENT_RESOURCE_BINDING_MISMATCH/u)
    await tool.execute('new', { session_id: 'ses_new' })
    if (optional) await tool.execute('other_selector', {})
    assert.equal(calls.length, optional ? 2 : 1)
  })
}

for (const [name, field] of [
  ['termous.commands.read_output', 'session_id'], ['termous.commands.interrupt', 'target_session_id'],
  ['termous.remoteops.services.operations.get', 'session_id'], ['termous.files.list', 'file_session_id'],
  ['termous.files.sessions.connect', 'file_access_profile_id'], ['custom.tool', 'session_id'],
]) {
  test(`${name} 的任务或文件身份保持原有语义`, async () => {
    const { mcp, calls } = fixture(name, field)
    const tool = bindRuntimeResourceTools(mcp, [ssh, file])[0]!
    assert.equal(tool, mcp.tools[0])
    const args = { [field!]: 'original_identity' }
    await tool.execute('history', args)
    assert.deepEqual(calls, [args])
  })
}

test('本轮目标的实际远端失败原样返回，不自动重发或切换连接', async () => {
  const { mcp } = fixture()
  let calls = 0
  const failure = new Error('SESSION_NOT_FOUND')
  mcp.tools[0]!.execute = async () => { calls++; throw failure }
  const tool = bindRuntimeResourceTools(mcp, [ssh])[0]!
  await assert.rejects(tool.execute('current', { session_ids: ['ses_new'] }), (error) => error === failure)
  assert.equal(calls, 1)
})

test('转发选择其他来源时保留省略和显式空 SSH 选择器，实际 SSH 来源仍复验', async () => {
  const { mcp, calls } = fixture('termous.forwarding.instances.start', 'session_id', true, {
    type: 'object', properties: {
      session_id: { type: 'string', description: '与其他三种来源四选一' },
      profile_id: { type: 'string' }, host_id: { type: 'string' }, ssh_profile_id: { type: 'string' },
    }, additionalProperties: false,
  })
  const tool = bindRuntimeResourceTools(mcp, [ssh])[0]!
  const schema = Compile(tool.parameters)
  for (const selector of ['profile_id', 'host_id', 'ssh_profile_id']) {
    for (const empty of [undefined, '', '  ']) {
      const args = { [selector]: 'chosen_source', ...(empty === undefined ? {} : { session_id: empty }) }
      assert.equal(schema.Check(args), true)
      assert.equal(tool.prepareArguments!(args), args)
      await tool.execute('other_source', args)
      assert.equal(calls[calls.length - 1], args)
    }
  }
  assert.match(tool.description, /不要补入 session_id/u)
  assert.match(JSON.stringify(tool.parameters), /与其他三种来源四选一/u)
  await assert.rejects(tool.execute('wrong_session', { session_id: 'ses_old' }), /AGENT_RESOURCE_BINDING_MISMATCH/u)
  assert.equal(calls.length, 9)
})

for (const [label, field, fieldSchema] of [
  ['标量枚举', 'session_id', { type: 'string', enum: ['ses_other'] }],
  ['数组子项枚举', 'session_ids', { type: 'array', items: { type: 'string', enum: ['ses_other'] } }],
  ['数组子项类型', 'session_ids', { type: 'array', items: { type: 'number' } }],
  ['数组最小数量', 'session_ids', { type: 'array', minItems: 2, items: { type: 'string' } }],
  ['数组最大数量', 'session_ids', { type: 'array', maxItems: 0, items: { type: 'string' } }],
  ['禁用的数组子项', 'session_ids', { type: 'array', items: false }],
] satisfies [string, string, NonNullable<MCPTool['inputSchema']['properties']>[string]][]) {
  test(`绑定约束不放宽原合同的${label}`, () => {
    const { mcp, definition } = fixture(field === 'session_id' ? 'termous.sessions.get' : undefined, field, false, {
      type: 'object', properties: { [field]: fieldSchema }, required: [field], additionalProperties: false,
    })
    const original = structuredClone(definition.inputSchema)
    const tool = bindRuntimeResourceTools(mcp, [ssh])[0]!
    const args = { [field]: field === 'session_id' ? 'ses_new' : ['ses_new'] }
    assert.equal(Compile(original).Check(args), false)
    assert.equal(Compile(tool.parameters).Check(args), false)
    assert.deepEqual(definition.inputSchema, original)
  })
}

test('目标校验保留原参数准备、取消信号、更新回调和返回结果', async () => {
  const { mcp } = fixture()
  const raw = { session_ids: ['ses_new'], command: 'ls', client_request_id: 'same_request' }
  const prepared = { ...raw }
  const signal = new AbortController().signal
  const onUpdate = () => undefined
  const result = { content: [{ type: 'text' as const, text: '原始结果' }], details: { original: true } }
  let prepares = 0
  let executes = 0
  mcp.tools[0]!.prepareArguments = (args) => {
    assert.equal(args, raw)
    prepares++
    return prepared
  }
  mcp.tools[0]!.execute = async (id, args, forwardedSignal, forwardedUpdate) => {
    assert.equal(id, 'original_call')
    assert.equal(args, prepared)
    assert.equal(forwardedSignal, signal)
    assert.equal(forwardedUpdate, onUpdate)
    executes++
    return result
  }
  const tool = bindRuntimeResourceTools(mcp, [ssh])[0]!
  assert.equal(tool.prepareArguments!(raw), prepared)
  assert.equal(await tool.execute('original_call', prepared, signal, onUpdate), result)
  assert.equal(prepares, 1)
  assert.equal(executes, 1)
})
