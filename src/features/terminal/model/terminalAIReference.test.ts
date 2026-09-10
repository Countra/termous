import assert from 'node:assert/strict'
import test from 'node:test'
import { freezeTerminalAIReferenceSnapshot, type TerminalAIReferenceSnapshot } from './terminalAIReference.ts'

test('引用目标置顶优先、其余按最近活动排序，来源与目标冻结后不跟随后续改动', () => {
  const source = { host_id: 'host-1', host_name: '生产', ssh_profile_id: 'ssh-1', ssh_profile_name: '默认', started_at: '2026-09-09T00:00:00Z' }
  const input: TerminalAIReferenceSnapshot = { canReference: true, ready: true, source, targets: [
    { session_id: 'old', title: '较早', last_activity_at: '2026-09-01T00:00:00Z' },
    { session_id: 'recent', title: '最新', last_activity_at: '2026-09-09T00:00:00Z' },
    { session_id: 'pin', title: '置顶', pinned: true, last_activity_at: '2026-08-01T00:00:00Z' },
  ] }
  const frozen = freezeTerminalAIReferenceSnapshot(input)
  assert.deepEqual(frozen.targets.map(({ session_id }) => session_id), ['pin', 'recent', 'old'])
  assert.deepEqual(input.targets.map(({ session_id }) => session_id), ['old', 'recent', 'pin'])
  source.host_name = '已变化'
  input.targets[0].title = '已改名'
  assert.equal(frozen.source?.host_name, '生产')
  assert.equal(frozen.targets[2].title, '较早')
})
