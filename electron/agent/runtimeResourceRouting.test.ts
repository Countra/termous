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
const profile: RuntimeResourceBinding = {
  kind: 'ssh_profile', ssh_profile_id: 'ssh_profile_bound', ssh_profile_name: '不可信配置名称',
  host_id: 'host_profile_bound', host_name: '不可信主机名称', platform: 'linux',
  bound_at: '2026-09-10T08:00:00Z',
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

function profileFixture(
  definitions: MCPTool[],
  invoke: (name: string, args: Record<string, unknown>) => Record<string, unknown>,
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const mapped = mapMCPTools(definitions, async (definition, args) => {
    calls.push({ name: definition.name, args })
    return {
      content: [{ type: 'text', text: '已执行' }],
      structuredContent: invoke(definition.name, args),
    }
  })
  const mcp: AgentMCPConnection = {
    tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {},
  }
  return { calls, mcp }
}

function profileTool(mcp: AgentMCPConnection, name: string) {
  const tool = mcp.tools.find((candidate) => mcp.originalName(candidate.name) === name)
  assert.ok(tool, `缺少工具 ${name}`)
  return tool
}

function profileDefinitions(): MCPTool[] {
  const sessionSelector = (name: string): MCPTool => ({
    name,
    inputSchema: {
      type: 'object', properties: { session_id: { type: 'string' } },
      required: ['session_id'], additionalProperties: false,
    },
  })
  return [
    { name: 'termous.sessions.list', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'termous.sessions.connect',
      inputSchema: {
        type: 'object', properties: {
          client_request_id: { type: 'string' }, host_id: { type: 'string' }, ssh_profile_id: { type: 'string' },
        }, required: ['client_request_id'], additionalProperties: false,
      },
    },
    sessionSelector('termous.sessions.get'),
    sessionSelector('termous.sessions.close'),
    {
      name: 'termous.commands.dispatch',
      inputSchema: {
        type: 'object', properties: { session_ids: { type: 'array', items: { type: 'string' } } },
        required: ['session_ids'], additionalProperties: false,
      },
    },
    sessionSelector('termous.remoteops.inventory.get'),
    {
      name: 'termous.forwarding.instances.start',
      inputSchema: {
        type: 'object', properties: {
          client_request_id: { type: 'string' }, profile_id: { type: 'string' }, session_id: { type: 'string' },
          host_id: { type: 'string' }, ssh_profile_id: { type: 'string' },
        }, required: ['client_request_id'], additionalProperties: false,
      },
    },
    {
      name: 'termous.commands.read_output',
      inputSchema: {
        type: 'object', properties: { task_id: { type: 'string' }, session_id: { type: 'string' } },
        required: ['task_id', 'session_id'], additionalProperties: false,
      },
    },
    {
      name: 'termous.commands.interrupt',
      inputSchema: {
        type: 'object', properties: { task_id: { type: 'string' }, target_session_id: { type: 'string' } },
        required: ['task_id'], additionalProperties: false,
      },
    },
    {
      name: 'termous.remoteops.services.operations.get',
      inputSchema: {
        type: 'object', properties: { operation_id: { type: 'string' }, session_id: { type: 'string' } },
        required: ['operation_id'], additionalProperties: false,
      },
    },
  ]
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

test('Profile 绑定只允许精确 Profile 建连且在会话 ready 前禁止目标操作', async () => {
  let phase = 'queued'
  const { mcp, calls } = profileFixture(profileDefinitions(), (name) => name === 'termous.sessions.connect'
    ? { session: {
      id: 'ses_profile_connect', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
      status: phase === 'ready' ? 'connected' : 'connecting', phase,
    } }
    : name === 'termous.sessions.get'
      ? { session: {
        id: 'ses_profile_connect', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
        status: 'connected', phase: 'ready',
      } }
      : {})
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile, file]) }
  const connect = profileTool(bound, 'termous.sessions.connect')
  const dispatch = profileTool(bound, 'termous.commands.dispatch')
  const get = profileTool(bound, 'termous.sessions.get')
  const schema = Compile(connect.parameters)
  const valid = { client_request_id: 'profile_connect', ssh_profile_id: profile.ssh_profile_id }
  assert.equal(schema.Check(valid), true)
  assert.equal(schema.Check({ client_request_id: 'other', ssh_profile_id: 'ssh_other' }), false)
  assert.equal(schema.Check({ client_request_id: 'host', host_id: profile.host_id }), false)
  assert.equal(schema.Check({ client_request_id: 'missing' }), false)

  for (const args of [
    { client_request_id: 'other', ssh_profile_id: 'ssh_other' },
    { client_request_id: 'host', host_id: profile.host_id },
    { client_request_id: 'both', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id },
  ]) {
    const check = (error: unknown) => {
      assert.ok(error instanceof Error)
      const detail = JSON.parse(error.message)
      assert.equal(detail.code, 'AGENT_RESOURCE_BINDING_MISMATCH')
      assert.equal(detail.dispatched, false)
      assert.deepEqual(detail.expected_arguments, { ssh_profile_id: profile.ssh_profile_id })
      assert.doesNotMatch(error.message, /不可信|bound_at/u)
      return true
    }
    assert.throws(() => connect.prepareArguments!(args), check)
    await assert.rejects(connect.execute('invalid_connect', args), check)
  }
  assert.equal(calls.length, 0)

  await connect.execute('connect', valid)
  await assert.rejects(
    dispatch.execute('too_early', { session_ids: ['ses_profile_connect'] }),
    /AGENT_RESOURCE_BINDING_MISMATCH/u,
  )
  phase = 'ready'
  await get.execute('poll_ready', { session_id: 'ses_profile_connect' })
  await dispatch.execute('ready_dispatch', { session_ids: ['ses_profile_connect'] })
  assert.deepEqual(calls.map(({ name }) => name), [
    'termous.sessions.connect', 'termous.sessions.get', 'termous.commands.dispatch',
  ])
})

test('Profile 会话清单只登记双重匹配身份且必须经查询确认就绪', async () => {
  const matching = (id: string, status: string, phase: string) => ({
    id, host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id, status, phase,
  })
  const { mcp, calls } = profileFixture(profileDefinitions(), (name, args) => {
    if (name === 'termous.sessions.list') return { sessions: [
      matching('ses_ready', 'connected', 'ready'),
      matching('ses_connecting', 'connecting', 'handshake'),
      { ...matching('ses_wrong_host', 'connected', 'ready'), host_id: 'host_other' },
      { ...matching('ses_wrong_profile', 'connected', 'ready'), ssh_profile_id: 'ssh_other' },
    ] }
    if (name === 'termous.sessions.get') return { session: matching(
      args.session_id as string,
      'connected',
      'ready',
    ) }
    return {}
  })
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
  await profileTool(bound, 'termous.sessions.list').execute('list', {})
  const dispatch = profileTool(bound, 'termous.commands.dispatch')
  const inventory = profileTool(bound, 'termous.remoteops.inventory.get')
  for (const sessionID of ['ses_ready', 'ses_connecting', 'ses_wrong_host', 'ses_wrong_profile', 'ses_forged']) {
    await assert.rejects(
      dispatch.execute('blocked', { session_ids: [sessionID] }),
      /AGENT_RESOURCE_BINDING_MISMATCH/u,
    )
  }
  await profileTool(bound, 'termous.sessions.get').execute('get_ready', { session_id: 'ses_ready' })
  await dispatch.execute('ready', { session_ids: ['ses_ready'] })
  await inventory.execute('ready_remoteops', { session_id: 'ses_ready' })
  await profileTool(bound, 'termous.sessions.get').execute('get', { session_id: 'ses_connecting' })
  await dispatch.execute('newly_ready', { session_ids: ['ses_connecting'] })
  assert.deepEqual(calls.map(({ name }) => name), [
    'termous.sessions.list', 'termous.sessions.get', 'termous.commands.dispatch',
    'termous.remoteops.inventory.get', 'termous.sessions.get', 'termous.commands.dispatch',
  ])
})

test('Profile 完整会话清单会淘汰已消失的旧会话', async () => {
  const session = {
    id: 'ses_removed', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
    status: 'connected', phase: 'ready',
  }
  let sessions = [session]
  const { mcp, calls } = profileFixture(profileDefinitions(), (name) => {
    if (name === 'termous.sessions.list') return { sessions }
    if (name === 'termous.sessions.get') return { session }
    return {}
  })
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
  const list = profileTool(bound, 'termous.sessions.list')
  const dispatch = profileTool(bound, 'termous.commands.dispatch')
  await list.execute('list_initial', {})
  await profileTool(bound, 'termous.sessions.get').execute('get_ready', { session_id: session.id })
  await dispatch.execute('ready', { session_ids: [session.id] })

  sessions = []
  await list.execute('list_after_close', {})
  const callsAfterList = calls.length
  await assert.rejects(
    dispatch.execute('removed', { session_ids: [session.id] }),
    /AGENT_RESOURCE_BINDING_MISMATCH/u,
  )
  assert.equal(calls.length, callsAfterList)
})

for (const failedTool of ['termous.sessions.get', 'termous.sessions.close'] as const) {
  test(`Profile ${failedTool} 返回 MCP 错误后淘汰旧的 ready 会话`, async () => {
    const session = {
      id: 'ses_stale', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
      status: 'connected', phase: 'ready',
    }
    let failTargetOperation = false
    const calls: string[] = []
    const definitions = profileDefinitions()
    const mapped = mapMCPTools(definitions, async (definition) => {
      calls.push(definition.name)
      if (definition.name === failedTool && failTargetOperation) {
        return { content: [{ type: 'text', text: '会话状态不可确认' }], isError: true }
      }
      if (definition.name === 'termous.sessions.list') {
        return { content: [], structuredContent: { sessions: [session] } }
      }
      if (definition.name === 'termous.sessions.get') {
        return { content: [], structuredContent: { session } }
      }
      if (definition.name === 'termous.sessions.close') {
        return { content: [], structuredContent: { session_id: session.id, closed: true } }
      }
      return { content: [{ type: 'text', text: '已执行' }] }
    })
    const mcp: AgentMCPConnection = {
      tools: mapped.tools,
      originalName: (name) => mapped.originalNames.get(name) ?? null,
      close: async () => {},
    }
    const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
    await profileTool(bound, 'termous.sessions.list').execute('list', {})
    await profileTool(bound, 'termous.sessions.get').execute('get_ready', { session_id: session.id })
    await profileTool(bound, 'termous.commands.dispatch').execute('ready', { session_ids: [session.id] })

    failTargetOperation = true
    await profileTool(bound, failedTool).execute('failed', { session_id: session.id })
    const callsAfterFailure = calls.length
    await assert.rejects(
      profileTool(bound, 'termous.commands.dispatch').execute('stale', { session_ids: [session.id] }),
      /AGENT_RESOURCE_BINDING_MISMATCH/u,
    )
    assert.equal(calls.length, callsAfterFailure)
  })
}

test('Profile 建连、查询和关闭会话均复核 MCP 结构化结果身份', async () => {
  const listed = [
    { id: 'ses_get', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id, status: 'connecting', phase: 'queued' },
    { id: 'ses_close', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id, status: 'connected', phase: 'ready' },
  ]
  const { mcp, calls } = profileFixture(profileDefinitions(), (name) => {
    if (name === 'termous.sessions.list') return { sessions: listed }
    if (name === 'termous.sessions.connect') return { session: {
      id: 'ses_connect_wrong', host_id: 'host_other', ssh_profile_id: profile.ssh_profile_id,
      status: 'connected', phase: 'ready',
    } }
    if (name === 'termous.sessions.get') return { session: {
      id: 'ses_other', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
      status: 'connected', phase: 'ready',
    } }
    if (name === 'termous.sessions.close') return { session_id: 'ses_other', closed: true }
    return {}
  })
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
  await profileTool(bound, 'termous.sessions.list').execute('list', {})
  const check = (error: unknown) => {
    assert.ok(error instanceof Error)
    const detail = JSON.parse(error.message)
    assert.equal(detail.code, 'AGENT_RESOURCE_BINDING_RESULT_MISMATCH')
    assert.equal(detail.dispatched, true)
    assert.equal(detail.resource.kind, 'ssh_profile')
    assert.doesNotMatch(error.message, /不可信|bound_at/u)
    return true
  }
  await assert.rejects(profileTool(bound, 'termous.sessions.connect').execute('connect', {
    client_request_id: 'wrong_result', ssh_profile_id: profile.ssh_profile_id,
  }), check)
  await assert.rejects(profileTool(bound, 'termous.sessions.get').execute('get', { session_id: 'ses_get' }), check)
  await assert.rejects(profileTool(bound, 'termous.sessions.close').execute('close', { session_id: 'ses_close' }), check)

  const callsAfterMismatch = calls.length
  await assert.rejects(
    profileTool(bound, 'termous.sessions.get').execute('get_again', { session_id: 'ses_get' }),
    /AGENT_RESOURCE_BINDING_MISMATCH/u,
  )
  await assert.rejects(
    profileTool(bound, 'termous.commands.dispatch').execute('closed_again', { session_ids: ['ses_close'] }),
    /AGENT_RESOURCE_BINDING_MISMATCH/u,
  )
  assert.equal(calls.length, callsAfterMismatch)
})

test('Profile 绑定下转发只允许精确 Profile 或经查询确认就绪的会话', async () => {
  const forwardSession = {
    id: 'ses_forward_ready', host_id: profile.host_id, ssh_profile_id: profile.ssh_profile_id,
    status: 'connected', phase: 'ready',
  }
  const { mcp, calls } = profileFixture(profileDefinitions(), (name) => name === 'termous.sessions.list'
    ? { sessions: [forwardSession] }
    : name === 'termous.sessions.get' ? { session: forwardSession } : {})
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
  const list = profileTool(bound, 'termous.sessions.list')
  const start = profileTool(bound, 'termous.forwarding.instances.start')
  await list.execute('list', {})
  const schema = Compile(start.parameters)
  const byProfile = { client_request_id: 'forward_profile', ssh_profile_id: profile.ssh_profile_id }
  const bySession = { client_request_id: 'forward_session', session_id: 'ses_forward_ready' }
  assert.equal(schema.Check(byProfile), true)
  assert.equal(schema.Check(bySession), true)
  assert.equal(schema.Check({ client_request_id: 'host', host_id: profile.host_id }), false)
  assert.equal(schema.Check({ client_request_id: 'saved', profile_id: 'forward_saved' }), false)
  assert.equal(schema.Check({ client_request_id: 'other', ssh_profile_id: 'ssh_other' }), false)
  await start.execute('by_profile', byProfile)
  await assert.rejects(start.execute('session_before_get', bySession), /AGENT_RESOURCE_BINDING_MISMATCH/u)
  await profileTool(bound, 'termous.sessions.get').execute('get_forward', { session_id: 'ses_forward_ready' })
  await start.execute('by_session', bySession)
  for (const args of [
    { client_request_id: 'none' },
    { client_request_id: 'host', host_id: profile.host_id },
    { client_request_id: 'saved', profile_id: 'forward_saved' },
    { client_request_id: 'other', ssh_profile_id: 'ssh_other' },
    { client_request_id: 'forged', session_id: 'ses_forged' },
    { client_request_id: 'both', session_id: 'ses_forward_ready', ssh_profile_id: profile.ssh_profile_id },
  ]) {
    await assert.rejects(start.execute('blocked', args), /AGENT_RESOURCE_BINDING_MISMATCH/u)
  }
  assert.deepEqual(calls.map(({ name }) => name), [
    'termous.sessions.list', 'termous.forwarding.instances.start',
    'termous.sessions.get', 'termous.forwarding.instances.start',
  ])
})

test('Profile 绑定不重定向历史命令输出、中断和服务操作身份', async () => {
  const { mcp, calls } = profileFixture(profileDefinitions(), () => ({}))
  const bound = { ...mcp, tools: bindRuntimeResourceTools(mcp, [profile]) }
  const cases = [
    ['termous.commands.read_output', { task_id: 'task_old', session_id: 'ses_old' }],
    ['termous.commands.interrupt', { task_id: 'task_old', target_session_id: 'ses_old' }],
    ['termous.remoteops.services.operations.get', { operation_id: 'operation_old', session_id: 'ses_old' }],
  ] as const
  for (const [name, args] of cases) {
    const original = profileTool(mcp, name)
    const routed = profileTool(bound, name)
    assert.equal(routed, original)
    await routed.execute('history', args)
  }
  assert.deepEqual(calls.map(({ args }) => args), cases.map(([, args]) => args))
})
