import assert from 'node:assert/strict'
import test from 'node:test'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import { isRuntimeResourceBindings } from '../contracts/resourceBindings.ts'
import { runtimeResourceIdentity, bindRuntimeResourceTools } from './runtimeResourceRouting.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'

const target = { kind: 'host_desktop' as const, instance_id: 'core', host: { id: 'display', kind: 'screen' as const, title: '不可信名称', generation: 3 } }
const binding = { kind: 'host_desktop', host_name: '', desktop_target: target, bound_at: '2026-10-24T00:00:00Z' } satisfies RuntimeResourceBinding

function fixture() {
  let response: Record<string, unknown> = {}
  let wait: Promise<void> | undefined
  const calls: string[] = []
  const names = ['sources', 'attach', 'get', 'detach', 'capture', 'pointer.click', 'close'].map(name => `termous.desktops.${name}`)
  const mapped = mapMCPTools(names.map(name => ({ name, inputSchema: { type: 'object', properties: {} } })), async tool => {
    calls.push(tool.name)
    const output = response
    const pending = wait
    wait = undefined
    if (pending) await pending
    return { content: [], structuredContent: output }
  })
  const originalName = (name: string) => mapped.originalNames.get(name) ?? null
  const tools = bindRuntimeResourceTools({ ...mapped, originalName, close: async () => {} }, [binding])
  return { calls, tool: (name: string) => tools.find(tool => originalName(tool.name) === `termous.desktops.${name}`)!,
    respond: (value: Record<string, unknown>) => { response = value },
    defer: () => { let done!: () => void; wait = new Promise(resolve => { done = resolve }); return done },
  }
}

test('宿主启动合同接受精确身份但拒绝混入协议目标，系统提示不注入来源标题', () => {
  assert.equal(isRuntimeResourceBindings([binding]), true)
  assert.equal(isRuntimeResourceBindings([{ ...binding, session_id: 'forged' }]), false)
  assert.equal(isRuntimeResourceBindings([{ ...binding, desktop_target: { ...target, instance_id: '' } }]), false)
  assert.equal(JSON.stringify(runtimeResourceIdentity(binding)).includes(target.host.title), false)
})

test('本机操作必须先发现并附着本轮精确目标，不能复用历史或协议身份', async () => {
  const f = fixture()
  await assert.rejects(f.tool('attach').execute('a', { target }), /AGENT_RESOURCE_BINDING_MISMATCH/)
  assert.equal(f.calls.length, 0)
  f.respond({ sources: [{ target }] })
  await f.tool('sources').execute('s', { kind: 'screen' })
  await assert.rejects(f.tool('attach').execute('wrong', { target: { ...target, instance_id: 'old' } }), /MISMATCH/)
  f.respond({ attachment: { id: 'a', target, state: 'ready' } })
  await f.tool('attach').execute('a', { target })
  await f.tool('capture').execute('c', { attachment_id: 'a' })
  await assert.rejects(f.tool('capture').execute('old', { attachment_id: 'history' }), /MISMATCH/)
  await assert.rejects(f.tool('close').execute('p', { session_id: 'session' }), /MISMATCH/)
})

test('释放后迟到查询不能恢复本机附着，来源代次变化不自动重绑', async () => {
  const f = fixture()
  f.respond({ sources: [{ target }] })
  await f.tool('sources').execute('s', { kind: 'screen' })
  f.respond({ attachment: { id: 'a', target, state: 'ready' } })
  await f.tool('attach').execute('a', { target })
  const finish = f.defer()
  const pending = f.tool('get').execute('late', { attachment_id: 'a' })
  f.respond({ completed: true })
  await f.tool('detach').execute('d', { attachment_id: 'a' })
  finish()
  await pending
  await assert.rejects(f.tool('pointer.click').execute('click', { attachment_id: 'a' }), /MISMATCH/)
  f.respond({ sources: [{ target: { ...target, host: { ...target.host, generation: 4 } } }] })
  await f.tool('sources').execute('s2', { kind: 'screen' })
  await assert.rejects(f.tool('attach').execute('a2', { target }), /MISMATCH/)
})
