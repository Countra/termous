import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeSessionSnapshotEvent,
} from '../entities/session/model/sessionSnapshot.ts'
import type { Session } from '../entities/session/model/types.ts'
import {
  affectedSessionIds,
  decideSessionSnapshot,
  initialSessionSnapshotCursor,
} from '../app/data-runtime/model/sessionSnapshotState.ts'
import { mergeSessionReloadSnapshot } from '../app/data-runtime/model/sessionInventoryState.ts'

test('会话清单协议只接受 canonical 完整快照', () => {
  const session = sessionFixture('session-a')
  const event = decodeSessionSnapshotEvent({
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 3,
    sessions: [session],
  })

  assert.equal(event.instance_id, 'core-a')
  assert.equal(event.sessions[0]?.id, 'session-a')
  assert.equal(event.sessions[0]?.origin, 'app')
  assert.equal(decodeSessionSnapshotEvent({
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 4,
    sessions: [{ ...session, status: 'waiting_host_trust' }],
  }).sessions[0]?.status, 'waiting_host_trust')
  assert.equal(decodeSessionSnapshotEvent({
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 5,
    sessions: [{ ...session, origin: 'mcp' }],
  }).sessions[0]?.origin, 'mcp')
  assert.throws(() => decodeSessionSnapshotEvent({
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 6,
    sessions: [{ ...session, origin: 'external' }],
  }), /会话来源/)
  assert.throws(() => decodeSessionSnapshotEvent({
    type: 'snapshot',
    instance_id: 'core-a',
    revision: 3,
    sessions: [],
  }), /事件类型/)
  assert.throws(() => decodeSessionSnapshotEvent({
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 3,
    sessions: [session, session],
  }), /重复会话/)
})

test('会话清单按连接代际、Core 实例和修订号拒绝迟到快照', () => {
  const first = decideSessionSnapshot(initialSessionSnapshotCursor, {
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 4,
    sessions: [],
  }, 1)
  assert.equal(first.accepted, true)

  const repeatedOnNewConnection = decideSessionSnapshot(first.cursor, {
    type: 'session_snapshot',
    instance_id: 'core-a',
    revision: 4,
    sessions: [],
  }, 2)
  assert.equal(repeatedOnNewConnection.accepted, false)
  assert.equal(repeatedOnNewConnection.cursor.generation, 2)

  const staleGeneration = decideSessionSnapshot(repeatedOnNewConnection.cursor, {
    type: 'session_snapshot',
    instance_id: 'stale-core',
    revision: 99,
    sessions: [],
  }, 1)
  assert.equal(staleGeneration.accepted, false)

  const restartedCore = decideSessionSnapshot(staleGeneration.cursor, {
    type: 'session_snapshot',
    instance_id: 'core-b',
    revision: 0,
    sessions: [],
  }, 2)
  assert.equal(restartedCore.accepted, true)
})

test('权威快照的增删修订阻止迟到 GET 复活或删除会话', () => {
  const removed = sessionFixture('removed')
  const added = sessionFixture('added')
  const baseline = new Map<string, number>()
  const latest = new Map<string, number>([
    ['removed', 1],
    ['added', 1],
  ])

  assert.deepEqual(affectedSessionIds([removed], [added]).sort(), ['added', 'removed'])
  assert.deepEqual(
    mergeSessionReloadSnapshot([added], [removed], baseline, latest),
    [added],
  )
})

function sessionFixture(id: string): Session {
  return {
    id,
    kind: 'ssh',
    origin: 'app',
    host_id: `host-${id}`,
    status: 'connected',
    started_at: '2026-08-13T08:00:00Z',
    connected_at: '2026-08-13T08:00:01Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}
