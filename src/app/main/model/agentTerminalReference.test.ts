import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentReferenceTargetsSnapshot, AgentSSHResourceState } from '#entities/agent'
import type { TerminalAIReferenceSelection } from '#features/terminal'
import { buildTerminalReferenceLaunch, projectTerminalAIReferenceSnapshot } from './agentTerminalReference.ts'

const source: AgentSSHResourceState = {
  session_id: 'ssh-one', host_id: 'host-one', ssh_profile_id: 'profile-one', host_name: '生产主机',
  ssh_profile_name: 'SSH', status: 'ready', started_at: '2026-09-08T08:00:00Z',
}
const selection: TerminalAIReferenceSelection = {
  sourceSessionId: source.session_id, source, target: { kind: 'new' },
  selectionText: '  first\r\n\tsecond\n', capturedAt: '2026-09-08T08:01:00Z',
}

test('终端引用保留原文、出处和精确 SSH 关联，不生成提问', () => {
  const request = buildTerminalReferenceLaunch(selection, [source])
  assert.equal(request.text, selection.selectionText)
  assert.equal(request.origin.line_count, 3)
  assert.equal(request.origin.captured_at, selection.capturedAt)
  assert.deepEqual(request.resource_reference, { kind: 'ssh_session', session_id: source.session_id })
  assert.equal('source_context' in request, false)
})

test('来源断线或同 ID 换代时拒绝转交，超限与NUL不截断', () => {
  for (const resources of [[], [{ ...source, status: 'unavailable' as const }], [{ ...source, started_at: '2026-09-08T08:02:00Z' }]]) {
    assert.throws(() => buildTerminalReferenceLaunch(selection, resources), /SOURCE_UNAVAILABLE/)
  }
  for (const selectionText of [' ', 'a\0b', '中'.repeat(100_000)]) {
    assert.throws(() => buildTerminalReferenceLaunch({ ...selection, selectionText }, [source]), /REFERENCE_INVALID/)
  }
})

test('仅需修改绑定的繁忙目标禁用，同源仍可引用', () => {
  const binding = { kind: 'ssh_session' as const, ...source, platform: 'linux' as const, bound_at: source.started_at }
  const sessions: AgentReferenceTargetsSnapshot = { ready: true, targets: [
    { session_id: 'same', title: '同源', binding_locked: true, resource_binding: binding },
    { session_id: 'other', title: '其他', binding_locked: true, resource_binding: { ...binding, session_id: 'ssh-two' } },
    { session_id: 'empty', title: '未绑定', binding_locked: false },
  ] }
  const snapshot = projectTerminalAIReferenceSnapshot(source.session_id, [source], sessions, true)
  assert.equal(snapshot.canReference, true)
  assert.deepEqual(snapshot.targets.map(({ disabled }) => disabled), [false, true, false])
  assert.equal(projectTerminalAIReferenceSnapshot(source.session_id, [source], sessions, false).canReference, false)
})
