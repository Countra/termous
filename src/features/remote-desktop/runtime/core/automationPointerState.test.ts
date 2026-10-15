import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopPointerEvent } from '#common/contracts'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { AutomationPointerState } from './automationPointerState.ts'

const event: DesktopPointerEvent = { type: 'automation_pointer', session_id: 'desktop', connection_generation: 2, revision: 5,
  pointer: { automation_id: 'grant', source: 'agent', execution_generation: 3, display_epoch: 1, sequence: 1, x: 20, y: 30, buttons: 0, action: 'click', occurred_at: new Date().toISOString() } }
const session = () => ({ id: 'desktop', connection_generation: 2, status: 'streaming', automation: { id: 'grant', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' }, automation_pointer: event.pointer, automation_pointer_revision: 5 }) as RemoteDesktopSession

test('清理后旧快照、乱序事件和不同连接均不能复活指针', () => {
  const state = new AutomationPointerState('desktop', 2)
  state.reconcile(session())
  assert.equal(state.snapshot()?.live, false)
  state.publish({ ...event, revision: 6, pointer: null })
  state.publish(event)
  state.reconcile(session())
  assert.equal(state.snapshot(), null)
  state.publish({ ...event, revision: 9, connection_generation: 3 })
  assert.equal(state.snapshot(), null)
  state.publish({ ...event, revision: 7 })
  assert.equal(state.snapshot()?.event.revision, 7)
  state.reconcile({ ...session(), automation: undefined })
  assert.equal(state.snapshot(), null)
})

test('重连只恢复位置，保留水位且初始状态不播放动作', () => {
  const state = new AutomationPointerState('desktop', 2)
  state.reconcile(session())
  state.suspend()
  assert.equal(state.snapshot(), null)
  state.reconcile(session())
  assert.equal(state.snapshot()?.event.revision, 5)
  assert.equal(state.snapshot()?.live, false)
  state.reconcile({ ...session(), automation: { ...session().automation!, idle_expires_at: '2000-01-01T00:00:00Z' } })
  assert.equal(state.snapshot(), null)
})

test('首次视觉消息即使先于会话快照到达也不重播点击', () => {
  const state = new AutomationPointerState('desktop', 2)
  state.publish({ ...event, snapshot: true })
  assert.equal(state.snapshot()?.live, false)
  state.reconcile(session())
  assert.equal(state.snapshot()?.live, false)
  state.publish({ ...event, revision: 6 })
  assert.equal(state.snapshot()?.live, true)
})

test('接管、续期与清理共享版本水位，旧会话快照不能复活待命指针', () => {
  const state = new AutomationPointerState('desktop', 2)
  const control = { automation_id: 'grant', source: 'agent' as const, execution_generation: 3, expires_at: '2099-01-01T00:00:00Z' }
  state.publish({ ...event, pointer: null, control })
  assert.deepEqual(state.control(), control)
  assert.equal(state.snapshot(), null)
  state.publish({ ...event, revision: 6, control })
  assert.equal(state.snapshot()?.live, true)
  state.publish({ ...event, revision: 7, control: null, pointer: null })
  state.reconcile({ ...session(), automation_pointer_control: control })
  assert.equal(state.control(), null)
  assert.equal(state.snapshot(), null)
  state.publish({ ...event, revision: 6, control })
  assert.equal(state.control(), null)
  state.publish({ ...event, revision: 8, control: { ...control, automation_id: 'new-grant' } })
  assert.equal(state.control()?.automation_id, 'new-grant')
  assert.equal(state.snapshot(), null)
  state.suspend()
  assert.equal(state.control(), null)
})

test('初始会话恢复待命状态，失效授权和其他连接不能展示指针', () => {
  const state = new AutomationPointerState('desktop', 2)
  const control = { automation_id: 'grant', source: 'workflow' as const, execution_generation: 3, expires_at: '2099-01-01T00:00:00Z' }
  state.reconcile({ ...session(), automation_pointer: undefined, automation_pointer_control: control })
  assert.equal(state.control()?.source, 'workflow')
  state.reconcile({ ...session(), connection_generation: 1, automation_pointer_control: null })
  assert.equal(state.control()?.source, 'workflow')
  state.publish({ ...event, revision: 6, control: { ...control, expires_at: '2000-01-01T00:00:00Z' } })
  assert.equal(state.control(), null)
  assert.equal(state.snapshot(), null)
})

test('过期会话状态不能隐藏新指针，也不能在断线后恢复旧接管', () => {
  const state = new AutomationPointerState('desktop', 2)
  const control = { automation_id: 'grant', source: 'agent' as const, execution_generation: 3, expires_at: '2099-01-01T00:00:00Z' }
  state.reconcile({ ...session(), automation_pointer_control: control })
  state.publish({ ...event, revision: 6, control })
  state.reconcile({ ...session(), status: 'reconnecting', automation_pointer_control: null })
  assert.equal(state.snapshot()?.event.revision, 6)
  assert.deepEqual(state.control(), control)
  state.reconcile({ ...session(), status: 'reconnecting', automation_pointer_revision: 7, automation_pointer_control: null, automation_pointer: undefined })
  state.reconcile({ ...session(), automation_pointer_control: control })
  assert.equal(state.control(), null)
  assert.equal(state.snapshot(), null)
  state.reconcile({ ...session(), automation_pointer_revision: 8, automation_pointer_control: control })
  assert.deepEqual(state.control(), control)
})

test('会话中的无效视觉字段不能覆盖已确认的接管状态', () => {
  const state = new AutomationPointerState('desktop', 2)
  const control = { automation_id: 'grant', source: 'agent' as const, execution_generation: 3, expires_at: '2099-01-01T00:00:00Z' }
  state.publish({ ...event, control })
  state.reconcile({ ...session(), automation_pointer_revision: 6, automation_pointer_control: { ...control, expires_at: 'invalid' } })
  assert.deepEqual(state.control(), control)
  assert.equal(state.snapshot()?.event.revision, 5)
})
