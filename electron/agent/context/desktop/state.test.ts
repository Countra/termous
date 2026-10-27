import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopObservationContext } from './state.ts'
import { restoreDesktopObservation } from './history.ts'
import { runtimeBootstrap, runtimePart } from '../../test-support/runtimeBootstrapTestFixture.ts'

const target = { kind: 'host_desktop' as const, instance_id: 'core-1', host: { id: 'screen', kind: 'screen' as const, title: '', generation: 1 } }
const ready = { attachment: { id: 'old', state: 'ready', target, grant: { id: 'secret-grant' } } }
const receipt = (data: unknown) => [{ type: 'text' as const, text: JSON.stringify(data) }]

test('只保存已确认目标，列表、失败及授权不能恢复本轮控制', () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.sources', {}, { sources: [{ target }] })
  assert.equal(context.current(), undefined)
  context.observe('termous.desktops.attach', {}, { ...ready, error: { code: 'failure' } })
  assert.equal(context.current(), undefined)
  context.observe('termous.desktops.attach', {}, ready)
  assert.deepEqual(context.current(), target)
  assert.ok(!JSON.stringify(context.snapshot()).includes('secret-grant'))
  const next = new DesktopObservationContext('chat', 'core-1')
  assert.equal(next.restore(context.snapshot()), true)
  assert.deepEqual(next.current(), target)
  assert.match(next.summary('deferred'), /discover_tools/)
  assert.match(next.summary('unavailable'), /unavailable under current permissions/)
  assert.ok(!next.summary('unavailable').includes('capture({})'))
  for (const other of [new DesktopObservationContext('another', 'core-1'), new DesktopObservationContext('chat', 'restarted')]) {
    assert.equal(other.restore(context.snapshot()), false)
    assert.equal(other.current(), undefined)
  }
})

test('协议目标不携带执行代次；清理其他附着不清除当前默认目标', () => {
  const context = new DesktopObservationContext('chat', 'core')
  context.observe('termous.desktops.attach', {}, { attachment: { id: 'a', state: 'ready', session_id: 'vnc', connection_generation: 2, execution_generation: 5 } })
  assert.deepEqual(context.current(), { kind: 'protocol_session', session_id: 'vnc', connection_generation: 2 })
  context.observe('termous.desktops.detach', { attachment_id: 'other' }, { completed: true })
  assert.ok(context.current())
  context.observe('termous.desktops.control.release', { attachment_id: 'a' }, { completed: true })
  assert.ok(context.current())
  context.observe('termous.desktops.close', { session_id: 'vnc', connection_generation: 1 }, { completed: true })
  assert.ok(context.current())
  context.observe('termous.desktops.detach', { attachment_id: 'a' }, { completed: true })
  assert.equal(context.snapshot().target, null)
})

test('精确协议绑定限制历史目标，绑定代次变更使快照失效', () => {
  const binding = { kind: 'desktop_session' as const, session_id: 'vnc', connection_generation: 2,
    desktop_profile_id: 'p', desktop_profile_name: 'Profile', host_id: 'h', host_name: 'Host', protocol: 'vnc' as const, bound_at: '2026-10-27T00:00:00Z' }
  const context = new DesktopObservationContext('chat', 'core', [binding])
  const expected = { kind: 'protocol_session', session_id: 'vnc', connection_generation: 2 }
  assert.deepEqual(context.selected(), expected)
  context.observe('termous.desktops.get', {}, { session: { id: 'another', connection_generation: 2, status: 'ready' } })
  assert.equal(context.current(), undefined)
  const next = new DesktopObservationContext('chat', 'core', [{ ...binding, connection_generation: 3 }])
  assert.equal(next.restore(context.snapshot()), false)
})

test('同目标新的附着可解决旧观察诊断，切换目标不解决其他目标诊断', () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, ready)
  context.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'new' } })
  assert.deepEqual(context.takeReplacedAttachments(), ['old'])
  context.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'different', target: { ...target, host: { ...target.host, id: 'screen2' } } } })
  assert.deepEqual(context.takeReplacedAttachments(), [])
})

test('准备中的替代附着只在同目标观察就绪后清除旧诊断，续接仍保留关联', () => {
  const context = new DesktopObservationContext('chat', 'core-1')
  context.observe('termous.desktops.attach', {}, ready)
  context.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'pending', state: 'preparing' } })
  assert.deepEqual(context.takeReplacedAttachments(), [])
  const resumed = new DesktopObservationContext('chat', 'core-1')
  assert.equal(resumed.restore(context.snapshot()), true)
  resumed.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'resumed' } })
  assert.ok(resumed.takeReplacedAttachments().includes('old'))
  context.observe('termous.desktops.capture', { attachment_id: 'pending' }, { capture: { target } })
  assert.ok(context.takeReplacedAttachments().includes('old'))

  context.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'pending-again', state: 'preparing' } })
  context.observe('termous.desktops.attach', {}, { attachment: { ...ready.attachment, id: 'another', target: { ...target, host: { ...target.host, id: 'another' } } } })
  assert.deepEqual(context.takeReplacedAttachments(), [])
})

test('检查点空状态覆盖保留尾部，损坏快照不会复活更早的附着', () => {
  const bootstrap = runtimeBootstrap()
  const context = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id)
  context.observe('termous.desktops.attach', {}, ready)
  context.observe('termous.desktops.detach', { attachment_id: 'old' }, { completed: true })
  bootstrap.context.checkpoint = { boundary_message_sequence: 1, summary: 'summary', estimated_tokens: 10,
    details: { desktop_context: context.snapshot() }, retained_tail: [{ role: 'toolResult', toolCallId: 'call', toolName: 'termous.desktops.attach',
      content: receipt(ready), isError: false, timestamp: 1 }] }
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
  bootstrap.context.checkpoint.details = { desktop_context: { version: 99 } }
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
  bootstrap.context.checkpoint.details = {}
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
})

test('未压缩聊天从回执恢复，固定绑定变更与 Core 重启使上下文失效', () => {
  const bootstrap = runtimeBootstrap()
  const context = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id)
  context.observe('termous.desktops.attach', {}, ready)
  const content = context.project({ content: receipt(ready), details: undefined }).content
  bootstrap.messages = [{ id: 'message', role: 'assistant', status: 'interrupted', sequence: 2, created_at: '2026-10-27T00:00:00Z', attachments: [],
    parts: [runtimePart('tool_result', 1, { tool_result: { tool_call_id: 'call', tool_name: 'termous.desktops.attach', content, is_error: false } })] }]
  assert.deepEqual(restoreDesktopObservation(bootstrap).current(), target)
  bootstrap.core_instance_id = 'restarted'
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
  bootstrap.core_instance_id = 'core-1'
  bootstrap.session.resource_bindings = [{ kind: 'host_desktop', desktop_target: { ...target, host: { ...target.host, id: 'screen2' } }, host_name: '', bound_at: '2026-10-27T01:00:00Z' }]
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
  assert.equal(restoreDesktopObservation(bootstrap).selected()?.kind, 'host_desktop')
})

test('第三方同名工具和失败参数不能成为观察目标', () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.messages = [{ id: 'message', role: 'assistant', status: 'completed', sequence: 2, created_at: '2026-10-27T00:00:00Z', attachments: [],
    parts: [runtimePart('tool_result', 1, { tool_result: { tool_call_id: 'call', tool_name: 'external::termous.desktops.attach', content: receipt(ready), is_error: false } })] }]
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
})

test('检查点之后的清空回执持久覆盖旧目标，恢复后再次压缩不会复活', () => {
  const bootstrap = runtimeBootstrap()
  const context = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id)
  context.observe('termous.desktops.attach', {}, ready)
  bootstrap.context.checkpoint = { boundary_message_sequence: 1, summary: 'summary', estimated_tokens: 10, details: { desktop_context: context.snapshot() } }
  context.observe('termous.desktops.detach', { attachment_id: 'old' }, { completed: true })
  bootstrap.messages = [{ id: 'message', role: 'assistant', status: 'completed', sequence: 2, created_at: '2026-10-27T00:00:00Z', attachments: [],
    parts: [runtimePart('tool_result', 1, { tool_result: { tool_call_id: 'detach', tool_name: 'termous.desktops.detach',
      content: context.project({ content: receipt({ completed: true }), details: undefined }).content, is_error: false } })] }]
  const restored = restoreDesktopObservation(bootstrap)
  assert.equal(restored.current(), undefined)
  bootstrap.context.checkpoint.details = { desktop_context: restored.snapshot() }
  bootstrap.messages = []
  assert.equal(restoreDesktopObservation(bootstrap).current(), undefined)
})
