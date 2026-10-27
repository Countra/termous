import assert from 'node:assert/strict'
import test from 'node:test'
import { isDesktopControlSnapshot, sameDesktopControl, type DesktopControlSnapshot } from './desktop-controls.ts'

const snapshot: DesktopControlSnapshot = { instance_id: 'core', controls: [{
  target: { kind: 'host_desktop', instance_id: 'capture', host: { id: 'display', title: 'Display', kind: 'screen', generation: 1 } },
  reference: 'a'.repeat(64), source: 'agent', name: 'Agent', active: true,
}] }
test('快照校验拒绝格式损坏，旧引用与旧 Core 不能收回后来控制', () => {
  assert.ok(isDesktopControlSnapshot(snapshot))
  assert.ok(!isDesktopControlSnapshot({ ...snapshot, controls: [{ ...snapshot.controls[0], reference: 'lease' }] }))
  const request = { ...snapshot.controls[0], instance_id: snapshot.instance_id }
  assert.ok(sameDesktopControl(request, snapshot))
  assert.ok(!sameDesktopControl({ ...request, instance_id: 'old' }, snapshot))
  assert.ok(!sameDesktopControl({ ...request, reference: 'b'.repeat(64) }, snapshot))
  assert.ok(!sameDesktopControl({ ...request, target: { kind: 'protocol_session', protocol: { session_id: 'other', connection_generation: 1 } } }, snapshot))
})
