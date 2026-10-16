import assert from 'node:assert/strict'
import test from 'node:test'
import { guidanceFixture } from './tool-guidance-fixture.mjs'

function setup(scenario = 'first') {
  let now = Date.parse('2026-10-16T00:00:00Z'), request = 0
  const calls = []
  const fixture = guidanceFixture(scenario, (call) => calls.push(call), () => now)
  const invoke = async (name, args = {}) => {
    const tool = fixture.mcp.tools.find((item) => fixture.mcp.originalName(item.name) === `termous.desktops.${name}`)
    const result = await tool.execute(String(++request), { attachment_id: 'synthetic-attachment', client_request_id: `request-${request}`, ...args })
    return result.details.result.structuredContent
  }
  const ready = async () => {
    await invoke('attach', { session_id: 'synthetic-session', connection_generation: 1 })
    return (await invoke('control.acquire')).control.attachment.grant
  }
  return { fixture, calls, invoke, ready, elapse: (ms) => { now += ms } }
}

test('合成夹具核对会话、附着和连接代次，不让错误目标通过', async () => {
  const { invoke, ready } = setup()
  assert.equal((await invoke('attach', { session_id: 'missing', connection_generation: 1 })).error.code, 'REMOTE_DESKTOP_SESSION_NOT_FOUND')
  assert.equal((await invoke('attach', { session_id: 'synthetic-session', connection_generation: 2 })).error.code, 'desktop_generation_stale')
  await ready()
  assert.equal((await invoke('get', { attachment_id: 'old' })).error.code, 'desktop_not_found')
  assert.equal((await invoke('get', { attachment_id: undefined, session_id: 'missing' })).error.code, 'REMOTE_DESKTOP_SESSION_NOT_FOUND')
  assert.equal((await invoke('get', { attachment_id: undefined, session_id: 'synthetic-session' })).session.status, 'ready')
})

test('合成查询不续租，错误授权不能输入或释放，过期后需重新取得授权', async () => {
  const { invoke, ready, elapse } = setup()
  const grant = await ready()
  elapse(1000)
  assert.deepEqual((await invoke('get')).attachment.grant, grant)
  assert.equal((await invoke('control.acquire')).error.code, 'desktop_control_already_held')
  for (const name of ['control.release', 'keyboard.text']) assert.equal((await invoke(name, { grant_id: 'old', text: 'Termous 验收' })).error.code, 'desktop_control_stale')
  assert.deepEqual((await invoke('get')).attachment.grant, grant)
  elapse(900000)
  assert.equal((await invoke('get')).attachment.grant, undefined)
  assert.equal((await invoke('keyboard.text', { grant_id: grant.id, text: 'Termous 验收' })).error.code, 'desktop_control_stale')
  assert.notEqual((await invoke('control.acquire')).control.attachment.grant.id, grant.id)
})

test('验收必须完成准确输入并归还控制权，观察与释放不算输入', async () => {
  for (const scenario of ['first', 'discover']) {
    const { invoke, ready, fixture, calls } = setup(scenario)
    const grant = await ready()
    assert.equal((await invoke('operations.get', { client_request_id: 'unknown' })).error.code, 'desktop_not_found')
    await invoke(scenario === 'first' ? 'clipboard.set_text' : 'keyboard.text', { grant_id: grant.id, text: 'Termous 验收' })
    assert.ok(!calls.at(-1).input)
    await invoke(scenario === 'first' ? 'keyboard.text' : 'clipboard.set_text', { grant_id: grant.id, text: 'Termous 验收', client_request_id: 'input' })
    assert.ok(calls.at(-1).input)
    assert.equal((await invoke('operations.get', { client_request_id: 'input' })).operation.state, 'completed')
    assert.equal(fixture.success(), false)
    await invoke('capture')
    assert.ok(!calls.at(-1).input)
    await invoke('control.release', { grant_id: grant.id })
    assert.ok(!calls.at(-1).input)
    assert.equal(fixture.success(), true)
  }
})
