import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeFileSessionSnapshotEvent,
  filterSuppressedFileSessions,
  normalizeFileSessionResponse,
  normalizeFileSessionResponseList,
  releaseConfirmedFileSessionCloseSuppressions,
  type FileSession,
} from '#entities/file'
import {
  affectedFileSessionIds,
  decideFileSessionSnapshot,
  initialFileSessionSnapshotCursor,
  reconcileAuthoritativeFileSessionSnapshot,
  reconcileVisibleAuthoritativeFileSessionSnapshot,
} from '../app/data-runtime/model/fileSessionSnapshotState.ts'

test('文件会话清单解码来源并兼容旧 Core', () => {
  const legacy = fileSession('legacy')
  const withoutOrigin = { ...legacy } as Partial<FileSession>
  delete withoutOrigin.origin
  const event = decodeFileSessionSnapshotEvent({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 4,
    sessions: [withoutOrigin, fileSession('mcp', { origin: 'mcp' })],
  })

  assert.equal(event.sessions[0]?.origin, 'app')
  assert.equal(event.sessions[1]?.origin, 'mcp')
  assert.equal(normalizeFileSessionResponse(withoutOrigin).origin, 'app')
  assert.equal(normalizeFileSessionResponseList([withoutOrigin])[0]?.origin, 'app')
  assert.throws(() => decodeFileSessionSnapshotEvent({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 5,
    sessions: [{ ...legacy, origin: 'external' }],
  }), /文件会话来源/)
  assert.throws(() => decodeFileSessionSnapshotEvent({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 5,
    sessions: [{ ...legacy, state_seq: -1 }],
  }), /状态序号/)
  assert.throws(() => decodeFileSessionSnapshotEvent({
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 5,
    sessions: [{ ...legacy, connection_generation: 1.5 }],
  }), /连接代际/)
})

test('文件会话快照使用独立连接代际、实例和修订游标', () => {
  const first = decideFileSessionSnapshot(initialFileSessionSnapshotCursor, {
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 3,
    sessions: [],
  }, 1)
  assert.equal(first.accepted, true)

  const repeated = decideFileSessionSnapshot(first.cursor, {
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-a',
    revision: 3,
    sessions: [],
  }, 2)
  assert.equal(repeated.accepted, false)
  assert.equal(repeated.cursor.generation, 2)

  const lateConnection = decideFileSessionSnapshot(repeated.cursor, {
    type: 'file_session_snapshot',
    instance_id: 'late-instance',
    revision: 99,
    sessions: [],
  }, 1)
  assert.equal(lateConnection.accepted, false)

  const restartedCore = decideFileSessionSnapshot(lateConnection.cursor, {
    type: 'file_session_snapshot',
    instance_id: 'file-sessions-b',
    revision: 0,
    sessions: [],
  }, 2)
  assert.equal(restartedCore.accepted, true)
})

test('同一批处理中单会话新态先到时，旧全局帧不覆盖且仍发现未知、移除缺失会话', () => {
  const current = fileSession('current', {
    connection_generation: 2,
    state_seq: 7,
    current_path: '/newer',
  })
  const removed = fileSession('removed')
  const discovered = fileSession('discovered', { origin: 'mcp' })
  const result = reconcileAuthoritativeFileSessionSnapshot(
    [current, removed],
    [
      fileSession('current', {
        connection_generation: 2,
        state_seq: 6,
        current_path: '/stale',
      }),
      discovered,
    ],
    new Map(),
    new Map(),
  )

  assert.deepEqual(result, [current, discovered])
  assert.deepEqual(
    affectedFileSessionIds([current, removed], result).sort(),
    ['current', 'discovered', 'removed'],
  )
})

test('本地创建竞态只暂时保护缺失项，终止项由权威关闭快照移除', () => {
  const locallyCreated = fileSession('local-create')
  const terminated = fileSession('terminated', {
    status: 'failed',
    phase: 'failed',
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
  })
  const baseline = new Map<string, number>()
  const latest = new Map<string, number>([
    [locallyCreated.id, 1],
    [terminated.id, 1],
  ])

  assert.deepEqual(
    reconcileAuthoritativeFileSessionSnapshot(
      [locallyCreated, terminated],
      [],
      baseline,
      latest,
    ),
    [locallyCreated],
  )
  assert.deepEqual(
    reconcileAuthoritativeFileSessionSnapshot(
      [locallyCreated],
      [],
      latest,
      latest,
    ),
    [],
  )
})

test('已被全局快照确认的会话缺失时立即移除，不受单会话修订保护', () => {
  const connected = fileSession('known')

  assert.deepEqual(
    reconcileAuthoritativeFileSessionSnapshot(
      [connected],
      [],
      new Map(),
      new Map([[connected.id, 1]]),
      new Set([connected.id]),
    ),
    [],
  )
})

test('SSH 已移除时迟到全局帧不会复活关联文件会话，独立 MCP 会话仍保留', () => {
  const linked = fileSession('linked', { source_session_id: 'closed-ssh' })
  const independent = fileSession('independent', { origin: 'mcp' })

  assert.deepEqual(
    reconcileVisibleAuthoritativeFileSessionSnapshot(
      [],
      [linked, independent],
      new Set(),
      new Map(),
      new Map(),
    ),
    [independent],
  )
})

test('Core 实例切换时首帧直接替换旧实例文件会话', () => {
  const ghost = fileSession('old-local-create', {
    connection_generation: 9,
    state_seq: 12,
  })
  const restarted = fileSession('reused-id', {
    connection_generation: 1,
    state_seq: 1,
  })

  assert.deepEqual(
    reconcileVisibleAuthoritativeFileSessionSnapshot(
      [ghost, fileSession('reused-id', {
        connection_generation: 8,
        state_seq: 20,
      })],
      [restarted],
      new Set(),
      new Map(),
      new Map([
        [ghost.id, 1],
        [restarted.id, 1],
      ]),
      new Set(),
      true,
    ),
    [restarted],
  )
})

test('已抑制的恢复结果不会被全局文件会话快照重新发现', () => {
  const suppressed = fileSession('suppressed')
  const incoming = filterSuppressedFileSessions(
    [suppressed],
    new Map([[suppressed.id, 'original']]),
  )

  assert.deepEqual(
    reconcileVisibleAuthoritativeFileSessionSnapshot(
      [],
      incoming,
      new Set(),
      new Map(),
      new Map(),
    ),
    [],
  )
})

test('关闭意图阻止旧全局帧复活，并在权威缺失后独立释放', () => {
  const closed = fileSession('closed')
  const recoverySuppressed = fileSession('recovery-suppressed')
  const recoverySuppressions = new Map([[recoverySuppressed.id, 'original']])
  const closeSuppressions = new Set([closed.id])

  assert.deepEqual(
    filterSuppressedFileSessions(
      [closed, recoverySuppressed],
      recoverySuppressions,
    ),
    [closed],
  )
  assert.deepEqual(
    reconcileAuthoritativeFileSessionSnapshot(
      [closed],
      [closed],
      new Map(),
      new Map(),
      new Set([closed.id]),
      closeSuppressions,
    ),
    [closed],
  )
  assert.deepEqual(
    reconcileAuthoritativeFileSessionSnapshot(
      [],
      [closed],
      new Map(),
      new Map(),
      new Set([closed.id]),
      closeSuppressions,
    ),
    [],
  )
  releaseConfirmedFileSessionCloseSuppressions(
    closeSuppressions,
    [closed, recoverySuppressed],
  )
  assert.equal(closeSuppressions.has(closed.id), true)

  releaseConfirmedFileSessionCloseSuppressions(
    closeSuppressions,
    [recoverySuppressed],
  )
  assert.equal(closeSuppressions.has(closed.id), false)
  assert.equal(recoverySuppressions.get(recoverySuppressed.id), 'original')
  assert.deepEqual(
    filterSuppressedFileSessions(
      [closed],
      recoverySuppressions,
    ),
    [closed],
  )
})

function fileSession(
  id: string,
  patch: Partial<FileSession> = {},
): FileSession {
  return {
    id,
    host_id: `host-${id}`,
    origin: 'app',
    status: 'connected',
    phase: 'ready',
    current_path: '/',
    started_at: '2026-08-17T00:00:00Z',
    connection_generation: 1,
    state_seq: 1,
    ...patch,
  }
}
