import assert from 'node:assert/strict'
import test from 'node:test'
import { Compile } from 'typebox/compile'
import type { Tool as MCPTool } from '@modelcontextprotocol/client'
import { mapMCPTools, type AgentMCPConnection } from './mcpClientAdapter.ts'
import { bindRuntimeResourceTools, runtimeResourceIdentity } from './runtimeResourceRouting.ts'
import { isRuntimeDesktopBinding, runtimeDesktopRules, type RuntimeDesktopBinding, type RuntimeWorkflowBinding } from './runtimeDesktopBinding.ts'

const desktop: RuntimeDesktopBinding = {
  kind: 'desktop_session', session_id: 'desk_one', connection_generation: 2,
  desktop_profile_id: 'profile_one', desktop_profile_name: '不可信配置指令', host_id: 'host_one', host_name: '不可信主机指令',
  protocol: 'rdp', bound_at: '2026-10-14T00:00:00Z',
}
const workflow: RuntimeWorkflowBinding = {
  kind: 'desktop_workflow', workflow_id: 'script_one', workflow_name: '不可信脚本指令', workflow_version: 3,
  host_name: '', bound_at: desktop.bound_at,
}
const profile: RuntimeDesktopBinding = {
  kind: 'desktop_profile', desktop_profile_id: desktop.desktop_profile_id, desktop_profile_name: desktop.desktop_profile_name,
  host_id: desktop.host_id, host_name: desktop.host_name, protocol: 'vnc', bound_at: desktop.bound_at,
}

function fixture(bindings: Array<RuntimeDesktopBinding | RuntimeWorkflowBinding>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let response: Record<string, unknown> = {}
  let failed = false
  let pending: Promise<void> | undefined
  const names = ['termous.desktops.list', 'termous.desktops.get', 'termous.desktops.connect', 'termous.desktops.attach',
    'termous.desktops.close', 'termous.desktops.detach', 'termous.desktops.control.acquire', 'termous.desktops.control.release', 'termous.desktops.pointer.click',
    'termous.desktop_workflows.runs.start', 'termous.desktop_workflows.get', 'termous.desktop_workflows.captures.create']
  const definitions: MCPTool[] = names.map((name) => ({ name, inputSchema: {
    type: 'object', properties: {
      session_id: { type: 'string' }, connection_generation: { type: 'integer' }, profile_id: { type: 'string' },
      host_id: { type: 'string' }, attachment_id: { type: 'string' }, script_id: { type: 'string' }, version: { type: 'integer' },
    }, additionalProperties: false,
  } }))
  const mapped = mapMCPTools(definitions, async (definition, args) => {
    calls.push({ name: definition.name, args })
    const result = { content: [{ type: 'text' as const, text: '结果' }], structuredContent: response, isError: failed }
    const wait = pending
    pending = undefined
    if (wait) await wait
    return result
  })
  const mcp: AgentMCPConnection = { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} }
  const tools = bindRuntimeResourceTools(mcp, bindings)
  const tool = (name: string) => {
    const found = tools.find((v) => mcp.originalName(v.name) === name)
    assert.ok(found)
    return found
  }
  return { calls, tool, respond: (value: Record<string, unknown>, error = false) => { response = value; failed = error },
    deferNext: () => {
      let complete!: () => void
      pending = new Promise<void>((resolve) => { complete = resolve })
      return complete
    },
  }
}

function session(protocol = 'rdp', generation = 2) {
  return { id: 'desk_one', profile_id: 'profile_one', host_id: 'host_one', protocol, status: 'ready', connection_generation: generation }
}
const attachment = { id: 'attach_one', session_id: 'desk_one', connection_generation: 2, execution_generation: 1 }

test('桌面引用校验精确代次，必须先查询，再建立本轮附着', async () => {
  const f = fixture([desktop])
  const attach = f.tool('termous.desktops.attach')
  const click = f.tool('termous.desktops.pointer.click')
  f.respond({ sessions: [session()] })
  await f.tool('termous.desktops.list').execute('list', {})
  await assert.rejects(attach.execute('attach', { session_id: 'desk_one', connection_generation: 2 }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  assert.throws(() => click.prepareArguments?.({ attachment_id: 'old_attach' }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  const get = f.tool('termous.desktops.get')
  await assert.rejects(get.execute('wrong', { session_id: 'another' }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ session: session() }, true)
  await get.execute('failed_get', { session_id: 'desk_one' })
  await assert.rejects(attach.execute('failed_attach', { session_id: 'desk_one', connection_generation: 2 }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ session: session() })
  await get.execute('get', { session_id: 'desk_one' })
  await assert.rejects(attach.execute('old', { session_id: 'desk_one', connection_generation: 1 }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ attachment })
  await attach.execute('attach', { session_id: 'desk_one', connection_generation: 2 })
  await click.execute('click', { attachment_id: 'attach_one' })
  f.respond({ session: session('rdp', 3) })
  await get.execute('changed', { session_id: 'desk_one' })
  const before = f.calls.length
  await assert.rejects(click.execute('late', { attachment_id: 'attach_one' }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  assert.equal(f.calls.length, before)
})

test('桌面 Profile 不允许主机默认配置或伪造附着，关闭与解除后撤销路由记录', async () => {
  const f = fixture([profile])
  const connect = f.tool('termous.desktops.connect')
  for (const args of [{ host_id: 'host_one' }, { profile_id: 'another' }, { profile_id: 'profile_one', host_id: 'host_one' }]) {
    await assert.rejects(connect.execute('wrong', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
  }
  f.respond({ session: session('vnc') })
  await connect.execute('connect', { profile_id: 'profile_one' })
  f.respond({ attachment })
  await f.tool('termous.desktops.attach').execute('attach', { session_id: 'desk_one', connection_generation: 2 })
  await f.tool('termous.desktop_workflows.captures.create').execute('capture', { attachment_id: 'attach_one' })
  f.respond({ completed: true })
  await f.tool('termous.desktops.detach').execute('detach', { attachment_id: 'attach_one' })
  await assert.rejects(f.tool('termous.desktops.pointer.click').execute('late', { attachment_id: 'attach_one' }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  await f.tool('termous.desktops.close').execute('close', { session_id: 'desk_one', connection_generation: 2 })
  await assert.rejects(f.tool('termous.desktops.attach').execute('late', { session_id: 'desk_one', connection_generation: 2 }), /AGENT_RESOURCE_BINDING_MISMATCH/)
})

test('脚本引用固定启动版本与桌面，但允许读取其他版本用于比较', async () => {
  const f = fixture([desktop, workflow])
  const start = f.tool('termous.desktop_workflows.runs.start')
  const exact = { script_id: 'script_one', version: 3, session_id: 'desk_one', connection_generation: 2 }
  const schema = Compile(start.parameters)
  assert.equal(schema.Check(exact), true)
  assert.equal(schema.Check({ ...exact, version: 4 }), false)
  for (const args of [{ ...exact, version: 4 }, { ...exact, script_id: 'other' }, { ...exact, connection_generation: 3 }, { ...exact, profile_id: 'profile_one' }]) {
    await assert.rejects(start.execute('wrong', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
  }
  assert.equal(f.calls.length, 0)
  await start.execute('exact', exact)
  await f.tool('termous.desktop_workflows.get').execute('compare', { script_id: 'script_one', version: 4 })
  const only = fixture([workflow])
  await only.tool('termous.desktop_workflows.runs.start').execute('target', { script_id: 'script_one', version: 3, profile_id: 'explicit_target' })
})

test('查询失败后拒绝继续输入，但仍可归还和解除本轮自己的附着', async () => {
  const f = fixture([desktop])
  f.respond({ session: session() })
  await f.tool('termous.desktops.get').execute('get', { session_id: 'desk_one' })
  f.respond({ attachment })
  await f.tool('termous.desktops.attach').execute('attach', { session_id: 'desk_one', connection_generation: 2 })
  f.respond({ error: { code: 'desktop_disconnected' } }, true)
  await f.tool('termous.desktops.get').execute('failed_get', { session_id: 'desk_one' })
  await assert.rejects(f.tool('termous.desktops.pointer.click').execute('late', { attachment_id: attachment.id }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ completed: true })
  await f.tool('termous.desktops.control.release').execute('release', { attachment_id: attachment.id })
  await f.tool('termous.desktops.detach').execute('detach', { attachment_id: attachment.id })
  await assert.rejects(f.tool('termous.desktops.control.release').execute('late_release', { attachment_id: attachment.id }), /AGENT_RESOURCE_BINDING_MISMATCH/)
})

test('桌面与脚本 Bootstrap 拒绝混合身份，可信提示不包含展示名称', () => {
  for (const binding of [desktop, profile, workflow]) {
    assert.equal(isRuntimeDesktopBinding(binding), true)
    const prompt = JSON.stringify(runtimeResourceIdentity(binding)) + runtimeDesktopRules(binding).join('\n')
    assert.equal(prompt.includes('不可信'), false)
    assert.equal(isRuntimeDesktopBinding({ ...binding, ssh_profile_id: 'forged' }), false)
  }
  assert.equal(isRuntimeDesktopBinding({ ...desktop, connection_generation: 0 }), false)
  assert.equal(isRuntimeDesktopBinding({ ...workflow, workflow_version: 0 }), false)
  assert.equal(isRuntimeDesktopBinding({ ...workflow, host_name: '主机' }), false)
})

test('等待认证或尚未建立代次的自有连接可关闭，关闭失败仍可查询和重试清理', async () => {
  for (const generation of [0, 1]) {
    const f = fixture([profile])
    f.respond({ session: { ...session('vnc', generation), status: 'connecting' } })
    await f.tool('termous.desktops.connect').execute('connect', { profile_id: 'profile_one' })
    const args = { session_id: 'desk_one', connection_generation: generation }
    await assert.rejects(f.tool('termous.desktops.attach').execute('attach', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
    f.respond({ error: { code: 'unavailable' } }, true)
    await f.tool('termous.desktops.close').execute('close_failed', args)
    f.respond({ completed: true })
    await f.tool('termous.desktops.close').execute('close_retry', args)
    await assert.rejects(f.tool('termous.desktops.close').execute('already_closed', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
  }
})

test('迟到查询不能覆盖新的失败回执或复活已关闭的桌面', async () => {
  const f = fixture([profile])
  const get = f.tool('termous.desktops.get')
  const args = { session_id: 'desk_one', connection_generation: 2 }
  f.respond({ session: session('vnc') })
  await get.execute('initial', { session_id: 'desk_one' })
  const finishOld = f.deferNext()
  const old = get.execute('old', { session_id: 'desk_one' })
  f.respond({ error: { code: 'disconnected' } }, true)
  await get.execute('new', { session_id: 'desk_one' })
  finishOld()
  await old
  await assert.rejects(f.tool('termous.desktops.attach').execute('stale', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ session: session('vnc') })
  const finishBeforeClose = f.deferNext()
  const beforeClose = get.execute('before_close', { session_id: 'desk_one' })
  f.respond({ completed: true })
  await f.tool('termous.desktops.close').execute('close', args)
  finishBeforeClose()
  await beforeClose
  await assert.rejects(f.tool('termous.desktops.attach').execute('late', args), /AGENT_RESOURCE_BINDING_MISMATCH/)
})

test('附着查询失败后禁止输入但允许清理，迟到回执不能复活已解除的入口', async () => {
  const f = fixture([desktop])
  const get = f.tool('termous.desktops.get')
  f.respond({ session: session() })
  await get.execute('get', { session_id: 'desk_one' })
  f.respond({ attachment })
  await f.tool('termous.desktops.attach').execute('attach', { session_id: 'desk_one', connection_generation: 2 })
  const finishOld = f.deferNext()
  const old = get.execute('attachment_get', { attachment_id: attachment.id })
  f.respond({ error: { code: 'desktop_stale' } }, true)
  await get.execute('failed', { attachment_id: attachment.id })
  finishOld()
  await old
  await assert.rejects(f.tool('termous.desktops.pointer.click').execute('click', { attachment_id: attachment.id }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  f.respond({ attachment })
  const finishDetach = f.deferNext()
  const beforeDetach = get.execute('before_detach', { attachment_id: attachment.id })
  f.respond({ completed: true })
  await f.tool('termous.desktops.detach').execute('detach', { attachment_id: attachment.id })
  finishDetach()
  await beforeDetach
  await assert.rejects(get.execute('detached', { attachment_id: attachment.id }), /AGENT_RESOURCE_BINDING_MISMATCH/)
})
