import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopObservationContext } from '../../context/desktop/state.ts'
import { continuationHost as host, continuationMCP } from '../../test-support/desktopContinuationFixture.ts'
import { prepareBuiltinTools } from './index.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import { bindRuntimeResourceTools } from '../runtimeResourceRouting.ts'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'

function harness(respond: Parameters<typeof continuationMCP>[0], context = new DesktopObservationContext('chat', 'core-1'), bindings: RuntimeResourceBinding[] = []) {
  const { calls, mcp } = continuationMCP(respond)
  const persisted = new Map<string, PreparedCall>()
  const tools = prepareBuiltinTools({ ...mcp, tools: bindRuntimeResourceTools(mcp, bindings) }, { runID: 'next-run', generation: 2, desktop: context, bindings,
    lookup: async (id, step) => persisted.get(`${id}:${step}`), persist: async value => { persisted.set(`${value.tool_call_id}:${value.step}`, value) } })
  return { calls, context, run: async (suffix: string, args: Record<string, unknown> = {}, id = suffix, signal?: AbortSignal) => {
    const result = await tools.find(tool => mcp.originalName(tool.name) === `termous.desktops.${suffix}`)!.execute(id, args, signal)
    assert.ok(isMCPToolDetails(result.details))
    return result.details.result.structuredContent as Record<string, unknown>
  } }
}
const old = { attachment: { id: 'old', target: host, state: 'ready' } }
const stale = { error: { code: 'desktop_generation_stale', message: '旧附着已失效' } }

test('原聊天继续只继承目标，旧 get 引导 capture，新观察不申请控制', async () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  const h = harness((name) => name.endsWith('.get') ? stale : name.endsWith('.sources') ? { sources: [{ target: host }] }
    : name.endsWith('.attach') ? { attachment: { ...old.attachment, id: 'new' } } : { capture: { screenshot_id: 'new-shot', target: host } }, context)
  const failed = await h.run('get', { attachment_id: 'old' })
  const error = failed.error as { execution: { recovery: unknown } }
  assert.deepEqual(error.execution.recovery, { kind: 'reread', tool: 'termous.desktops.capture', arguments: {} })
  assert.ok((await h.run('capture')).capture)
  assert.deepEqual(h.calls.map(call => call.name), ['termous.desktops.get', 'termous.desktops.sources', 'termous.desktops.attach', 'termous.desktops.capture'])
  assert.equal(h.calls[h.calls.length - 1]!.args.attachment_id, 'new')
})

test('隐式失效附着只重新准备一次，显式旧截图及旧附着不被重定向', async () => {
  let attachCount = 0
  const h = harness(name => name.endsWith('.get') ? stale : name.endsWith('.sources') ? { sources: [{ target: host }] }
    : name.endsWith('.attach') ? { attachment: { ...old.attachment, id: `a${++attachCount}` } } : { capture: { screenshot_id: `shot${attachCount}`, target: host } })
  await h.run('attach', { target: host }, 'initial')
  await h.run('capture', {}, 'refresh')
  assert.equal(attachCount, 2)
  const explicit = await h.run('capture', { attachment_id: 'a1' }, 'explicit')
  assert.ok(explicit.error)
  assert.equal(attachCount, 2)
  assert.ok((await h.run('pointer.click', { screenshot_id: 'old-shot', x: 1, y: 2 })).error)
  assert.equal(h.calls.filter(call => call.name.endsWith('.pointer.click')).length, 0)
})

test('切换本机目标不复用缓存，失效显式目标不回退到原屏幕', async () => {
  const another = { ...host, host: { ...host.host, id: 'another' } }
  const h = harness((name, args) => name.endsWith('.sources') ? { sources: [{ target: host }, { target: another }] }
    : name.endsWith('.attach') ? { attachment: { id: args.target === undefined ? 'protocol' : (args.target as typeof host).host.id, state: 'ready', target: args.target } }
      : name.endsWith('.get') ? { attachment: { id: args.attachment_id, state: 'ready', target: host } } : { capture: { screenshot_id: 'shot', target: another } })
  await h.run('attach', { target: host }, 'first')
  h.context.observe('termous.desktops.attach', {}, { attachment: { id: 'different-selection', state: 'ready', target: another } })
  await h.run('capture')
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 2)
  assert.equal(h.calls[h.calls.length - 1]!.args.attachment_id, 'another')
  const failed = await h.run('attach', { target: { ...host, host: { ...host.host, generation: 9 } } }, 'invalid')
  assert.ok(failed.error)
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 2)
})

test('协议续接核验连接代次并重新读取执行端，不恢复旧执行代次', async () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.get', {}, { attachment: { id: 'old', state: 'ready', session_id: 'vnc', connection_generation: 2, execution_generation: 3 } })
  const h = harness(name => name.endsWith('.get') ? { session: { id: 'vnc', connection_generation: 2, status: 'ready' } }
    : name.endsWith('.attach') ? { attachment: { id: 'new', state: 'ready', session_id: 'vnc', connection_generation: 2, execution_generation: 8 } }
      : { capture: { screenshot_id: 'new-shot' } }, context)
  assert.ok((await h.run('capture')).capture)
  const attach = h.calls.find(call => call.name.endsWith('.attach'))!
  assert.equal(attach.args.connection_generation, 2)
  assert.equal(attach.args.execution_generation, undefined)
  const changed = harness(() => ({ session: { id: 'vnc', connection_generation: 9, status: 'ready' } }), context)
  assert.ok((await changed.run('capture')).error)
  assert.equal(changed.calls.length, 1)
})

test('生产准备路径保留绑定恢复提示', async () => {
  const binding = { kind: 'host_desktop' as const, desktop_target: host, host_name: '' as const, bound_at: '2026-10-27T00:00:00Z' }
  const context = new DesktopObservationContext('chat', 'core-1', [binding])
  const h = harness(() => { throw new Error('不应派发') }, context, [binding])
  const failed = await h.run('get', { attachment_id: 'old' })
  assert.equal((failed.error as { execution: { recovery: { tool: string } } }).execution.recovery.tool, 'termous.desktops.capture')
  assert.equal(h.calls.length, 0)
})

test('普通 JSON 异常不能冒充可信恢复合同', async () => {
  const { mcp } = continuationMCP(() => { throw new Error('不应派发') })
  const spoof = new Error(JSON.stringify({ code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false,
    required_tool: 'termous.desktops.attach', required_arguments: { target: host } }))
  mcp.tools = mcp.tools.map(tool => ({ ...tool, prepareArguments: () => { throw spoof } }))
  const tools = prepareBuiltinTools(mcp, { runID: 'run', generation: 1, lookup: async () => undefined, persist: async () => {} })
  const get = tools.find(tool => mcp.originalName(tool.name) === 'termous.desktops.get')!
  await assert.rejects(get.execute('call', { attachment_id: 'old' }), error => error === spoof)
})

test('人工处理、审批及派发未知不能重建隐式附着', async () => {
  for (const [dispatch, kind] of [['not_started', 'user_action'], ['not_started', 'approval'], ['not_started', 'none'], ['unknown', 'reread']]) {
    const failure = { error: { ...stale.error, execution: { phase: 'input', dispatch, recovery: { kind } } } }
    const h = harness(name => name.endsWith('.sources') ? { sources: [{ target: host }] }
      : name.endsWith('.attach') ? old : failure)
    await h.run('attach', { target: host })
    const result = await h.run('capture')
    assert.deepEqual((result.error as typeof failure.error).execution, failure.error.execution)
    assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
  }
  const network = harness(name => {
    if (name.endsWith('.sources')) return { sources: [{ target: host }] }
    if (name.endsWith('.attach')) return old
    throw new Error('network disconnected')
  })
  await network.run('attach', { target: host })
  await assert.rejects(network.run('capture'), /network disconnected/)
  assert.equal(network.calls.filter(call => call.name.endsWith('.attach')).length, 1)
})

test('连接代次不匹配的中间回执不改变默认目标', async () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, { attachment: { id: 'old', state: 'ready', session_id: 'vnc', connection_generation: 2 } })
  const h = harness(() => ({ session: { id: 'vnc', connection_generation: 9, status: 'ready' } }), context)
  assert.ok((await h.run('capture')).error)
  assert.deepEqual(context.current(), { kind: 'protocol_session', session_id: 'vnc', connection_generation: 2 })
})

test('同次本机附着重试保留精确来源，协议 target 转换为当前连接身份', async () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  const h = harness((name, args) => name.endsWith('.sources') ? { sources: [{ target: host }] }
    : name.endsWith('.attach') ? { attachment: { ...old.attachment, target: args.target } } : {}, context)
  await h.run('attach', {}, 'same-call')
  await h.run('attach', {}, 'same-call')
  assert.deepEqual(h.calls.filter(call => call.name.endsWith('.attach')).map(call => call.args.target), [host, host])
  assert.equal(h.calls.filter(call => call.name.endsWith('.sources')).length, 1)

  const namedTarget = { ...host, host: { ...host.host, title: 'Display name may change' } }
  await h.run('attach', { target: namedTarget }, 'named-call')
  await h.run('attach', { target: namedTarget }, 'named-call')
  const namedCalls = h.calls.filter(call => call.name.endsWith('.attach')).slice(-2)
  assert.deepEqual(namedCalls[0].args, namedCalls[1].args)
  assert.deepEqual(namedCalls[0].args.target, host)

  const protocol = harness(name => name.endsWith('.get') ? { session: { id: 'vnc', connection_generation: 2, status: 'ready' } }
    : { attachment: { id: 'new', state: 'ready', session_id: 'vnc', connection_generation: 2, execution_generation: 8 } })
  await protocol.run('attach', { target: { kind: 'protocol_session', protocol: { session_id: 'vnc', connection_generation: 2, execution_generation: 3 } } })
  const args = protocol.calls[protocol.calls.length - 1]!.args
  assert.equal(args.session_id, 'vnc')
  assert.equal(args.connection_generation, 2)
  assert.equal(args.target, undefined)
  assert.equal(args.execution_generation, undefined)
})

test('取消后迟到的发现回执不能创建附着或改变目标', async () => {
  const controller = new AbortController()
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  const h = harness(() => { controller.abort(); return { sources: [{ target: host }] } }, context)
  await assert.rejects(h.run('capture', {}, 'cancelled', controller.signal))
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.context.current(), host)
})

test('已登记旧截图不能重定向到新目标，显式其他附着不继承缓存身份', async () => {
  const another = { ...host, host: { ...host.host, id: 'screen-2' } }
  const h = harness((name, args) => name.endsWith('.sources') ? { sources: [{ target: host }] }
    : name.endsWith('.attach') ? old
      : name.endsWith('.get') ? args.attachment_id === 'other' ? { attachment: { id: 'other', state: 'ready', session_id: 'vnc', connection_generation: 1 } } : old
        : { capture: { screenshot_id: 'old-shot', target: host } })
  await h.run('attach', { target: host })
  await h.run('capture', {}, 'initial-capture')
  assert.ok((await h.run('capture', { attachment_id: 'other' }, 'explicit')).error)
  h.context.observe('termous.desktops.attach', {}, { attachment: { id: 'another', state: 'ready', target: another } })
  const failed = await h.run('pointer.click', { screenshot_id: 'old-shot', x: 10, y: 20 })
  assert.ok(failed.error)
  assert.equal(h.calls.filter(call => call.name.endsWith('.pointer.click') || call.name.includes('.control.')).length, 0)
  assert.equal(h.calls.filter(call => call.name.endsWith('.capture')).length, 1)
  assert.deepEqual(h.context.current(), another)
})

test('未就绪附着保留原身份，等待及人工处理不重复创建', async () => {
  for (const state of ['preparing', 'waiting_user_action', 'failed']) {
    let current = state
    const context = new DesktopObservationContext('chat', 'core-1')
    context.observe('termous.desktops.attach', {}, old)
    const h = harness(name => name.endsWith('.sources') ? { sources: [{ target: host }] }
      : name.endsWith('.attach') || name.endsWith('.get') ? { attachment: { id: 'pending', target: host, state: current } }
        : { capture: { screenshot_id: 'ready-shot', target: host } }, context)
    for (const id of ['first', 'second']) {
      const result = await h.run('capture', {}, id)
      const error = result.error as { execution: { recovery: unknown } }
      assert.deepEqual(error.execution.recovery, { kind: state === 'preparing' ? 'wait' : 'user_action',
        tool: 'termous.desktops.get', arguments: { attachment_id: 'pending', wait_ms: 10000 } })
    }
    assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
    current = 'ready'
    assert.ok((await h.run('capture', {}, 'ready')).capture)
    assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
  }
})

test('显式切换到准备中的桌面后，隐式观察不会返回历史目标', async () => {
  const another = { ...host, host: { ...host.host, id: 'screen-2' } }
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  const h = harness((name, args) => name.endsWith('.sources') ? { sources: [{ target: host }, { target: another }] }
    : name.endsWith('.attach') ? { attachment: { id: 'pending', target: args.target, state: 'preparing' } }
      : { attachment: { id: 'pending', target: another, state: 'preparing' } }, context)
  await h.run('attach', { target: another })
  assert.ok((await h.run('capture')).error)
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
  assert.deepEqual(h.context.current(), another)
})

test('Profile 绑定的显式附着使用已核验会话匹配，不要求附着携带 Profile', async () => {
  const binding = { kind: 'desktop_profile' as const, desktop_profile_id: 'profile', host_id: 'server', protocol: 'vnc' as const,
    desktop_profile_name: 'Profile', host_name: 'Server', bound_at: '2026-10-27T00:00:00Z' }
  const session = { id: 'session', profile_id: 'profile', host_id: 'server', protocol: 'vnc', status: 'ready', connection_generation: 2 }
  const attachment = { id: 'attached', state: 'ready', session_id: session.id, connection_generation: 2, execution_generation: 3 }
  const h = harness((name, args) => name.endsWith('.list') ? { sessions: [session] }
    : name.endsWith('.get') ? args.session_id ? { session } : { attachment }
      : name.endsWith('.attach') ? { attachment } : { capture: { screenshot_id: 'shot' } },
  new DesktopObservationContext('chat', 'core-1', [binding]), [binding])
  assert.ok((await h.run('attach')).attachment)
  assert.ok((await h.run('capture', { attachment_id: attachment.id })).capture)
  assert.ok((await h.run('capture', {}, 'implicit')).capture)
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
})

test('准备层不覆盖可信回执的精确恢复动作与参数', async () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  for (const recovery of [
    { kind: 'reread', tool: 'termous.desktops.sources', arguments: { kind: 'screen' } },
    { kind: 'reread', tool: 'termous.desktops.attach', arguments: { target: host } },
  ]) {
    const h = harness(() => ({ error: { ...stale.error, execution: { phase: 'observation', dispatch: 'not_started', recovery } } }), context)
    const result = await h.run('get', { attachment_id: 'old' })
    assert.deepEqual((result.error as { execution: { recovery: unknown } }).execution.recovery, recovery)
  }
})

test('显式切换失败只清空旧目标，后续查询保留失败附着而不回到旧屏幕', async () => {
  const another = { ...host, host: { ...host.host, id: 'screen-2' } }
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, old)
  const h = harness(name => name.endsWith('.sources') ? { sources: [{ target: another }] }
    : { attachment: { id: 'failed', target: another, state: 'failed' } }, context)
  await h.run('attach', { target: another })
  assert.equal(context.current(), undefined)
  assert.ok((await h.run('capture')).error)
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
  assert.deepEqual(h.calls[h.calls.length - 1]?.args, { attachment_id: 'failed', wait_ms: 10000 })
})

test('隐式观察遇到精确恢复参数时返回建议，不自行重新附着', async () => {
  const recovery = { kind: 'reread', tool: 'termous.desktops.attach', arguments: { target: host } }
  const h = harness(name => name.endsWith('.sources') ? { sources: [{ target: host }] }
    : name.endsWith('.attach') ? old
      : { error: { ...stale.error, execution: { phase: 'observation', dispatch: 'not_started', recovery } } })
  await h.run('attach', { target: host })
  const result = await h.run('capture')
  assert.deepEqual((result.error as { execution: { recovery: unknown } }).execution.recovery, recovery)
  assert.equal(h.calls.filter(call => call.name.endsWith('.attach')).length, 1)
})
