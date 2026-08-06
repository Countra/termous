import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostKeyChallenge, HostKeyEvent } from '#entities/host-key'
import {
  hostKeyCoordinatorReducer,
  hostKeyEventNeedsReconciliation,
  initialHostKeyCoordinatorState,
} from './hostKeyState.ts'

function challenge(
  id: string,
  createdAt: string,
  overrides: Partial<HostKeyChallenge> = {},
): HostKeyChallenge {
  return {
    id,
    instance_id: 'core-a',
    endpoint: { canonical_host: 'host.example.com', port: 22 },
    reason: 'unknown',
    observed_key: { algorithm: 'ssh-ed25519', fingerprint_sha256: `SHA256:${id}` },
    contexts: [{ consumer_type: 'session', consumer_id: `session-${id}`, role: 'target' }],
    context_count: 0,
    state: 'pending',
    created_at: createdAt,
    expires_at: '2026-08-06T12:10:00.000Z',
    ...overrides,
  }
}

test('Host Key 快照只保留待确认项并规范顺序与上下文数量', () => {
  const state = hostKeyCoordinatorReducer(initialHostKeyCoordinatorState, {
    type: 'snapshot',
    snapshot: {
      instance_id: 'core-a',
      snapshot_revision: 4,
      challenges: [
        challenge('later', '2026-08-06T12:02:00.000Z'),
        challenge('resolved', '2026-08-06T12:00:00.000Z', { state: 'trusted' }),
        challenge('earlier', '2026-08-06T12:01:00.000Z'),
      ],
    },
  })

  assert.equal(state.ready, true)
  assert.equal(state.instanceId, 'core-a')
  assert.equal(state.revision, 4)
  assert.deepEqual(state.challenges.map((item) => item.id), ['earlier', 'later'])
  assert.equal(state.challenges[0].context_count, 1)
})

test('Host Key reducer 忽略同实例旧快照并接受新实例快照', () => {
  const current = {
    instanceId: 'core-a',
    revision: 8,
    challenges: [challenge('current', '2026-08-06T12:00:00.000Z')],
    ready: true,
  }
  const stale = hostKeyCoordinatorReducer(current, {
    type: 'snapshot',
    snapshot: { instance_id: 'core-a', snapshot_revision: 7, challenges: [] },
  })
  assert.equal(stale, current)

  const restarted = hostKeyCoordinatorReducer(current, {
    type: 'snapshot',
    snapshot: { instance_id: 'core-b', snapshot_revision: 1, challenges: [] },
  })
  assert.equal(restarted.instanceId, 'core-b')
  assert.equal(restarted.revision, 1)
  assert.deepEqual(restarted.challenges, [])
})

test('Host Key 事件只按连续 revision 应用并识别重新对账条件', () => {
  const current = {
    instanceId: 'core-a',
    revision: 3,
    challenges: [challenge('existing', '2026-08-06T12:00:00.000Z')],
    ready: true,
  }
  const nextChallenge = challenge('next', '2026-08-06T12:01:00.000Z')
  const sequential: HostKeyEvent = {
    instance_id: 'core-a',
    snapshot_revision: 4,
    type: 'challenge_upsert',
    challenge: nextChallenge,
  }
  const applied = hostKeyCoordinatorReducer(current, { type: 'event', event: sequential })
  assert.equal(applied.revision, 4)
  assert.deepEqual(applied.challenges.map((item) => item.id), ['existing', 'next'])
  assert.equal(hostKeyEventNeedsReconciliation(current, sequential), false)

  const gap = { ...sequential, snapshot_revision: 6 }
  assert.equal(hostKeyCoordinatorReducer(current, { type: 'event', event: gap }), current)
  assert.equal(hostKeyEventNeedsReconciliation(current, gap), true)
  assert.equal(hostKeyEventNeedsReconciliation(current, { ...sequential, instance_id: 'core-b' }), true)
})
