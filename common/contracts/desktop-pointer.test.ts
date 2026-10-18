import assert from 'node:assert/strict'
import test from 'node:test'
import { isDesktopPointerEvent } from './desktop-pointer.ts'

test('视觉合同拒绝不安全坐标、身份缺失、代次缺失和伪造字段类型', () => {
  const pointer = { automation_id: 'grant', source: 'agent', execution_generation: 2, display_epoch: 1, sequence: 1,
    x: 0, y: 0, buttons: 0, action: 'move', occurred_at: '2026-10-15T01:00:00Z' }
  const event = { type: 'automation_pointer', session_id: 'session', connection_generation: 1, revision: 1, pointer }
  assert.equal(isDesktopPointerEvent(event), true)
  assert.equal(isDesktopPointerEvent({ ...event, pointer: null }), true)
  for (const patch of [{ x: -1 }, { y: Infinity }, { x: 0.5 }, { buttons: 8 }, { buttons: '1' }, { sequence: 0 }, { source: ['agent'] }, { display_epoch: 0 }, { action: 'text' }]) {
    assert.equal(isDesktopPointerEvent({ ...event, pointer: { ...pointer, ...patch } }), false, JSON.stringify(patch))
  }
  for (const patch of [{ revision: 0 }, { connection_generation: 0 }, { pointer: undefined }, { session_id: '' }]) assert.equal(isDesktopPointerEvent({ ...event, ...patch }), false)
})

test('待命合同允许空位置，拒绝无效授权期限和来源，兼容旧事件', () => {
  const event = { type: 'automation_pointer', session_id: 'session', connection_generation: 1, revision: 1, pointer: null }
  const control = { automation_id: 'grant', source: 'agent', execution_generation: 1, expires_at: '2099-01-01T00:00:00Z' }
  assert.equal(isDesktopPointerEvent({ ...event, control }), true)
  assert.equal(isDesktopPointerEvent({ ...event, control: null }), true)
  assert.equal(isDesktopPointerEvent(event), true)
  for (const patch of [{ automation_id: '' }, { source: 'user-name' }, { execution_generation: 0 }, { expires_at: 'invalid' }]) {
    assert.equal(isDesktopPointerEvent({ ...event, control: { ...control, ...patch } }), false)
  }
})
