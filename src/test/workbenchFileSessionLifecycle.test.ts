import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session, SessionStatus } from '../types/domain.ts'
import type { FileSession, FileSessionStatus } from '#entities/file'
import {
  filterFileSessionsByActiveSources,
  mergeFileSessionSnapshot,
  reconcileFileSessionSnapshotList,
  replaceFileSessionSnapshot,
  upsertFileSessionSnapshot,
} from '#entities/file'
import {
  beginFileSessionRecovery,
  buildSourceSessionContexts,
  cancelSupersededFileSessionRecovery,
  canRetryFileSessionRecovery,
  canCompleteFileSessionRecovery,
  canUseSourceFileSession,
  failFileSessionRecovery,
  fileSessionRecoveryMethod,
  fileSessionRecoveryPresentationKind,
  idleFileSessionRecoveryState,
  isRecoveredFileSessionReady,
  markFileSessionRecoveryTerminated,
  mergeFileSessionUpdate,
  reconcileDisconnectedFileSessionRecovery,
  pruneFileSessionRecoveries,
  requireFileSessionRecovery,
  resolveFileSessionUpdate,
  resolveSourceFileSession,
  resolveSourceFileSessionWithClosure,
  runSingleFileSessionRecovery,
  selectCurrentFileSessionSnapshot,
  shouldCreateFileSessionAfterReconnect,
  shouldMaintainFileSessionEventStream,
  shouldSilentlyCancelFileSessionRecovery,
  waitForFileSessionRecovery,
} from '../features/workbench/workbenchFileSessionLifecycle.ts'
import { FileSessionRecoverySupersededError } from '#entities/file'

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'fs-1',
    host_id: 'host-1',
    source_session_id: 'session-1',
    status: 'connecting',
    phase: 'queued',
    progress: 5,
    current_path: '/',
    started_at: '2026-07-21T00:00:00Z',
    ...overrides,
  }
}

function sourceSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    host_id: 'host-1',
    kind: 'ssh',
    status: 'connected',
    phase: 'ready',
    pty_cols: 120,
    pty_rows: 32,
    started_at: '2026-07-21T00:00:00Z',
    ...overrides,
  }
}

test('源 SSH 活跃时为仍可能产生事件的文件会话保持事件流', () => {
  for (const status of ['connecting', 'connected', 'waiting_trust'] satisfies FileSessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, status), true)
  }
})

test('源 SSH 断开、失败或已有结束时间时停止文件会话事件流', () => {
  for (const status of ['disconnected', 'failed'] satisfies SessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream(status, undefined, 'connected'), false)
  }
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', '2026-07-19T12:00:00Z', 'connected'),
    false,
  )
})

test('源 SSH 开始关闭后立即停止文件会话事件流', () => {
  for (const status of ['connecting', 'connected', 'waiting_trust'] satisfies FileSessionStatus[]) {
    assert.equal(
      shouldMaintainFileSessionEventStream('connected', undefined, status, true),
      false,
    )
  }
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', undefined, 'connected', false),
    true,
  )
})

test('工作站页面或文件详情不可见时停止文件会话事件流', () => {
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', undefined, 'connected', false, false),
    false,
  )
  assert.equal(
    shouldMaintainFileSessionEventStream('connected', undefined, 'connected', false, true),
    true,
  )
})

test('源会话权威状态阻止删除成功后的旧文件会话复活并允许删除失败恢复', () => {
  const override = fileSession({ status: 'connected', phase: 'ready', progress: 100 })
  const activeContexts = buildSourceSessionContexts([sourceSession()])
  const removedContexts = buildSourceSessionContexts([])
  const noClosingSessions = new Set<string>()
  const closingSourceA = new Set(['session-1'])

  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(resolveSourceFileSession(true, override, undefined), override)

  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', closingSourceA), false)
  assert.equal(canUseSourceFileSession(activeContexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(canUseSourceFileSession(removedContexts, 'session-1', 'host-1', noClosingSessions), false)
  assert.equal(resolveSourceFileSession(false, override, override), null)
})

test('同 ID 文件会话优先按连接代际和状态序号选择权威快照', () => {
  const override = fileSession({
    started_at: '2026-07-20T00:00:00Z',
    connection_generation: 4,
    state_seq: 7,
  })
  const persisted = fileSession({
    started_at: '2026-07-22T00:00:00Z',
    connection_generation: 3,
    state_seq: 99,
  })
  assert.equal(resolveSourceFileSession(true, override, persisted), override)
  assert.equal(resolveSourceFileSession(true, persisted, override), override)

  const newerSequence = fileSession({
    started_at: '2026-07-19T00:00:00Z',
    connection_generation: 4,
    state_seq: 8,
  })
  assert.equal(resolveSourceFileSession(true, override, newerSequence), newerSequence)

  const legacyOlder = fileSession({ started_at: '2026-07-20T00:00:00Z' })
  const legacyNewer = fileSession({ started_at: '2026-07-21T00:00:00Z' })
  assert.equal(resolveSourceFileSession(true, legacyOlder, legacyNewer), legacyNewer)
})

test('跨页面关闭新文件会话时不会被旧 ID 的工作站快照覆盖', () => {
  const staleOverride = fileSession({
    id: 'fs-old',
    status: 'connected',
    phase: 'ready',
    started_at: '2026-07-23T00:00:00Z',
  })
  const closedSession = fileSession({
    id: 'fs-closed',
    status: 'connected',
    phase: 'ready',
    started_at: '2026-07-23T00:01:00Z',
  })
  const closure = { session: closedSession, phase: 'closed' as const }

  const closed = resolveSourceFileSessionWithClosure(true, staleOverride, undefined, closure)
  assert.equal(closed?.id, closedSession.id)
  assert.equal(closed?.error_code, 'SFTP_FILE_SESSION_NOT_FOUND')

  const persistedClosed = resolveSourceFileSessionWithClosure(
    true,
    staleOverride,
    closedSession,
    closure,
  )
  assert.equal(persistedClosed?.id, closedSession.id)
  assert.equal(persistedClosed?.error_code, 'SFTP_FILE_SESSION_NOT_FOUND')

  const replacement = fileSession({
    id: 'fs-replacement',
    status: 'connected',
    phase: 'ready',
    started_at: '2026-07-23T00:02:00Z',
  })
  assert.equal(
    resolveSourceFileSessionWithClosure(true, staleOverride, replacement, closure),
    replacement,
  )
})

test('异步文件请求按所属 source 校验，不受活动远程或本地页签切换干扰', () => {
  const contexts = buildSourceSessionContexts([
    sourceSession(),
    sourceSession({ id: 'session-2', host_id: 'host-2' }),
  ])
  const noClosingSessions = new Set<string>()
  const closingSourceA = new Set(['session-1'])
  const closingSourceB = new Set(['session-2'])

  // 切换到 B 或本地页签不会让仍存活的 A 响应失效。
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', noClosingSessions), true)
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', closingSourceB), true)

  // 后台关闭 A 只阻断 A；删除失败移除 closing 后，同一 source 可以恢复。
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', closingSourceA), false)
  assert.equal(canUseSourceFileSession(contexts, 'session-2', 'host-2', closingSourceA), true)
  assert.equal(canUseSourceFileSession(contexts, 'session-1', 'host-1', noClosingSessions), true)
})

test('文件会话进入终止态或不存在时停止事件流', () => {
  for (const status of ['disconnected', 'failed'] satisfies FileSessionStatus[]) {
    assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, status), false)
  }
  assert.equal(shouldMaintainFileSessionEventStream('connected', undefined, null), false)
})

test('同一次文件连接的乱序更新不会让进度回退', () => {
  const waiting = fileSession({
    status: 'waiting_trust',
    phase: 'waiting_host_trust',
    progress: 55,
    status_message: '等待确认主机指纹',
  })
  const resumed = mergeFileSessionUpdate(waiting, fileSession({
    phase: 'resolving_auth',
    progress: 18,
    status_message: '主机指纹已确认，正在继续连接',
  }))

  assert.equal(resumed.progress, 55)
  assert.equal(resumed.phase, 'resolving_auth')
  assert.equal(resumed.status_message, '主机指纹已确认，正在继续连接')
  assert.equal(mergeFileSessionUpdate(resumed, fileSession({
    phase: 'sftp_handshake',
    progress: 78,
  })).progress, 78)
})

test('明确重连允许新一轮进度重置并拒绝终态后的旧连接快照', () => {
  const failed = fileSession({ status: 'failed', phase: 'failed', progress: 100 })
  const reconnecting = fileSession({ status: 'connecting', phase: 'queued', progress: 5 })

  assert.equal(mergeFileSessionUpdate(failed, reconnecting), failed)
  assert.equal(mergeFileSessionUpdate(failed, reconnecting, true).progress, 5)

  const connected = fileSession({ status: 'connected', phase: 'ready', progress: 100 })
  assert.equal(mergeFileSessionUpdate(connected, reconnecting), connected)
})

test('文件会话更新严格按 ID、连接代际和状态序号合并', () => {
  const current = fileSession({
    id: 'fs-current',
    status: 'connected',
    phase: 'ready',
    progress: 100,
    connection_generation: 4,
    state_seq: 12,
  })

  assert.equal(mergeFileSessionUpdate(current, fileSession({
    id: 'fs-current',
    connection_generation: 3,
    state_seq: 99,
  })), current)
  assert.equal(mergeFileSessionUpdate(current, fileSession({
    id: 'fs-current',
    connection_generation: 4,
    state_seq: 11,
  })), current)
  assert.equal(mergeFileSessionUpdate(current, fileSession({
    id: 'fs-current',
    connection_generation: 4,
    state_seq: 12,
    status: 'failed',
  })), current)
  assert.equal(mergeFileSessionUpdate(current, fileSession({
    id: 'fs-current',
    connection_generation: undefined,
    state_seq: undefined,
  })), current)
  assert.equal(mergeFileSessionUpdate(current, fileSession({ id: 'fs-old' })), current)

  const nextGeneration = mergeFileSessionUpdate(current, fileSession({
    id: 'fs-current',
    status: 'connecting',
    phase: 'queued',
    progress: 5,
    connection_generation: 5,
    state_seq: 1,
  }))
  assert.equal(nextGeneration.connection_generation, 5)
  assert.equal(nextGeneration.progress, 5)

  const replacement = fileSession({ id: 'fs-replacement' })
  assert.equal(mergeFileSessionUpdate(current, replacement, true, true), replacement)
})

test('工作站仅将通过代际与序号校验的文件会话快照同步到全局状态', () => {
  const current = fileSession({
    status: 'connected',
    phase: 'ready',
    progress: 100,
    connection_generation: 4,
    state_seq: 12,
  })

  const stale = resolveFileSessionUpdate(current, fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 4,
    state_seq: 11,
  }))
  assert.equal(stale.accepted, false)
  assert.equal(stale.session, current)

  const accepted = resolveFileSessionUpdate(current, fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    progress: 10,
    connection_generation: 4,
    state_seq: 13,
  }))
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.session.status, 'disconnected')
  assert.equal(accepted.session.state_seq, 13)
  assert.equal(accepted.session.progress, 100)
})

test('全局文件会话快照保持连接代际和状态序号单调', () => {
  const current = fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 3,
    state_seq: 10,
  })

  assert.equal(mergeFileSessionSnapshot(current, fileSession({
    connection_generation: 2,
    state_seq: 999,
  })), current)
  assert.equal(mergeFileSessionSnapshot(current, fileSession({
    connection_generation: 3,
    state_seq: 10,
  })), current)
  assert.equal(mergeFileSessionSnapshot(current, fileSession({
    connection_generation: undefined,
    state_seq: undefined,
  })), current)
  assert.equal(mergeFileSessionSnapshot(current, fileSession({
    connection_generation: 3,
    state_seq: 11,
  })).state_seq, 11)
  assert.equal(mergeFileSessionSnapshot(current, fileSession({
    connection_generation: 4,
    state_seq: 1,
  })).connection_generation, 4)
})

test('全量刷新保留同 ID 的新状态并以服务端列表删除已消失会话', () => {
  const current = [
    fileSession({
      id: 'fs-current',
      connection_generation: 3,
      state_seq: 10,
      status: 'connected',
    }),
    fileSession({ id: 'fs-removed' }),
  ]
  const added = fileSession({ id: 'fs-added' })
  const reloaded = [
    fileSession({
      id: 'fs-current',
      connection_generation: 3,
      state_seq: 6,
      status: 'disconnected',
    }),
    added,
  ]

  const result = reconcileFileSessionSnapshotList(
    current,
    reloaded,
    new Map(),
    new Map(),
  )
  assert.deepEqual(result.map((session) => session.id), ['fs-current', 'fs-added'])
  assert.equal(result[0], current[0])
  assert.equal(result[1], added)
})

test('全量刷新不会删除请求期间创建的文件会话', () => {
  const created = fileSession({ id: 'fs-created', status: 'connecting' })
  const baseline = new Map<string, number>()
  const latest = new Map([['fs-created', 1]])

  assert.deepEqual(
    reconcileFileSessionSnapshotList([created], [], baseline, latest),
    [created],
  )
})

test('全量刷新不会用旧列表复活请求期间关闭的文件会话', () => {
  const closedSnapshot = fileSession({ id: 'fs-closed', status: 'connected' })
  const baseline = new Map([['fs-closed', 4]])
  const latest = new Map([['fs-closed', 5]])

  assert.deepEqual(
    reconcileFileSessionSnapshotList([], [closedSnapshot], baseline, latest),
    [],
  )

  const retainedAfterFailure = fileSession({
    id: 'fs-closed',
    status: 'disconnected',
    state_seq: 8,
  })
  assert.deepEqual(
    reconcileFileSessionSnapshotList(
      [retainedAfterFailure],
      [closedSnapshot],
      baseline,
      latest,
    ),
    [retainedAfterFailure],
  )
})

test('关闭成功后的第二次 revision 会拦截删除生效前取得的迟到列表', () => {
  const stale = fileSession({ id: 'fs-closing', status: 'connected' })
  const baselineAfterRequestStarted = new Map([['fs-closing', 1]])
  const latestAfterDeleteSucceeded = new Map([['fs-closing', 2]])

  assert.deepEqual(
    reconcileFileSessionSnapshotList(
      [],
      [stale],
      baselineAfterRequestStarted,
      latestAfterDeleteSucceeded,
    ),
    [],
  )
})

test('全部断开成功后的 revision 会为每个已删除文件会话保留 tombstone', () => {
  const stale = [
    fileSession({ id: 'fs-a' }),
    fileSession({ id: 'fs-b' }),
  ]
  const baseline = new Map([['fs-a', 3], ['fs-b', 7]])
  const latest = new Map([['fs-a', 4], ['fs-b', 8]])

  assert.deepEqual(
    reconcileFileSessionSnapshotList([], stale, baseline, latest),
    [],
  )
})

test('文件会话快照只保留仍存在的来源 SSH 会话和独立连接', () => {
  const active = fileSession({
    id: 'fs-active',
    source_session_id: 'ssh-active',
  })
  const retired = fileSession({
    id: 'fs-retired',
    source_session_id: 'ssh-retired',
  })
  const independent = fileSession({
    id: 'fs-independent',
    source_session_id: '',
  })

  assert.deepEqual(
    filterFileSessionsByActiveSources(
      [active, retired, independent],
      new Set(['ssh-active']),
    ),
    [active, independent],
  )
})

test('创建替代会话时原子移除旧 ID 并保留其他会话', () => {
  const oldSession = fileSession({ id: 'fs-old' })
  const other = fileSession({ id: 'fs-other' })
  const replacement = fileSession({ id: 'fs-new', connection_generation: 1 })

  assert.deepEqual(
    replaceFileSessionSnapshot([oldSession, other], replacement, oldSession.id),
    [replacement, other],
  )
})

test('新增文件会话追加到会话栏末尾，替代会话保持原位置', () => {
  const first = fileSession({ id: 'fs-first' })
  const oldSession = fileSession({ id: 'fs-old' })
  const last = fileSession({ id: 'fs-last' })
  const added = fileSession({ id: 'fs-added' })
  const replacement = fileSession({ id: 'fs-new' })

  assert.deepEqual(
    upsertFileSessionSnapshot([first, oldSession, last], added)
      .map((session) => session.id),
    ['fs-first', 'fs-old', 'fs-last', 'fs-added'],
  )
  assert.deepEqual(
    replaceFileSessionSnapshot(
      [first, oldSession, last],
      replacement,
      oldSession.id,
    ).map((session) => session.id),
    ['fs-first', 'fs-new', 'fs-last'],
  )
})

test('权威快照阻止迟到断线事件基于旧 override 回退状态', () => {
  const authoritative = fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 4,
    state_seq: 10,
  })
  const staleOverride = fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 4,
    state_seq: 5,
  })
  const lateDisconnect = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 4,
    state_seq: 6,
    error_code: 'SFTP_TRANSPORT_CLOSED',
    retryable: true,
  })
  const recovery = idleFileSessionRecoveryState
  const previous = selectCurrentFileSessionSnapshot(
    authoritative,
    staleOverride,
    undefined,
  )
  const merged = mergeFileSessionUpdate(previous, lateDisconnect)
  const nextRecovery = merged === previous
    ? recovery
    : reconcileDisconnectedFileSessionRecovery(recovery, merged)

  assert.equal(previous, authoritative)
  assert.equal(merged, authoritative)
  assert.equal(nextRecovery, recovery)
})

test('恢复事务区分可重连断线与已终止旧会话', () => {
  const disconnected = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 2,
    state_seq: 8,
    error_code: 'SFTP_TRANSPORT_CLOSED',
    retryable: true,
  })
  const required = requireFileSessionRecovery(
    idleFileSessionRecoveryState,
    disconnected,
    false,
  )
  assert.equal(required.phase, 'required')
  assert.equal(required.terminated, false)

  const requesting = beginFileSessionRecovery(required, disconnected.id, false)
  assert.equal(requesting.phase, 'requesting')
  const waiting = waitForFileSessionRecovery(requesting, fileSession({
    status: 'connecting',
    connection_generation: 3,
    state_seq: 1,
  }))
  assert.equal(waiting.phase, 'waiting_ready')
  assert.equal(isRecoveredFileSessionReady(waiting, fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 2,
    state_seq: 9,
  })), false)
  assert.equal(isRecoveredFileSessionReady(waiting, fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 3,
    state_seq: 4,
  })), true)

  const failed = failFileSessionRecovery(waiting, 'SFTP_CONNECT_FAILED')
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.errorCode, 'SFTP_CONNECT_FAILED')
  assert.equal(requireFileSessionRecovery(failed, disconnected, true).terminated, true)
})

test('恢复请求不会被旧断线快照打断，最终断线会进入明确失败态', () => {
  const disconnected = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 2,
    state_seq: 8,
  })
  const required = requireFileSessionRecovery(idleFileSessionRecoveryState, disconnected, false)
  const requesting = beginFileSessionRecovery(required, disconnected.id, false)
  assert.equal(reconcileDisconnectedFileSessionRecovery(requesting, disconnected), requesting)

  const waiting = waitForFileSessionRecovery(requesting, fileSession({
    connection_generation: 3,
    state_seq: 1,
  }))
  assert.equal(reconcileDisconnectedFileSessionRecovery(waiting, disconnected), waiting)

  const finalDisconnect = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 3,
    state_seq: 4,
    error_code: 'SFTP_TRANSPORT_CLOSED',
  })
  const failed = reconcileDisconnectedFileSessionRecovery(waiting, finalDisconnect)
  assert.equal(failed.phase, 'failed')
  assert.equal(reconcileDisconnectedFileSessionRecovery(failed, finalDisconnect), failed)
})

test('仅会话不存在错误降级为创建新文件会话', () => {
  assert.equal(shouldCreateFileSessionAfterReconnect({
    code: 'SFTP_FILE_SESSION_NOT_FOUND',
    status: 404,
  }), true)
  assert.equal(shouldCreateFileSessionAfterReconnect({ code: 'HTTP_ERROR', status: 404 }), false)
  assert.equal(shouldCreateFileSessionAfterReconnect({ code: 'SFTP_CONNECT_FAILED', status: 503 }), false)
})

test('显式关闭覆盖恢复事务时工作站静默交还给 closure 权威状态', () => {
  const superseded = new FileSessionRecoverySupersededError('fs-1')

  assert.equal(shouldSilentlyCancelFileSessionRecovery(superseded), true)
  assert.equal(shouldCreateFileSessionAfterReconnect(superseded), false)
  assert.equal(
    shouldSilentlyCancelFileSessionRecovery({ code: 'SFTP_CONNECT_FAILED' }),
    false,
  )
})

test('keepalive 切到文件页后关闭会话会退出恢复 busy 并采用 closure 终态', () => {
  const disconnected = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    error_code: 'SFTP_TRANSPORT_CLOSED',
  })
  const requesting = beginFileSessionRecovery(
    requireFileSessionRecovery(idleFileSessionRecoveryState, disconnected, false),
    disconnected.id,
    false,
  )
  const closedSnapshot = {
    ...disconnected,
    status: 'failed' as const,
    phase: 'failed' as const,
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
  }

  const canceled = cancelSupersededFileSessionRecovery(
    requesting,
    requesting.transaction,
    closedSnapshot,
    true,
  )
  assert.equal(canceled.phase, 'required')
  assert.equal(canceled.terminated, true)
  assert.equal(canceled.sessionId, closedSnapshot.id)
  assert.notEqual(canceled.transaction, requesting.transaction)

  assert.equal(
    cancelSupersededFileSessionRecovery(
      canceled,
      requesting.transaction,
      undefined,
      false,
    ),
    canceled,
  )
})

test('权威快照确认旧会话不存在后仍允许手动创建恢复', () => {
  const missing = fileSession({
    status: 'failed',
    phase: 'failed',
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
    retryable: false,
    connection_generation: 2,
    state_seq: 9,
  })
  const required = reconcileDisconnectedFileSessionRecovery(
    idleFileSessionRecoveryState,
    missing,
  )

  assert.equal(required.phase, 'required')
  assert.equal(required.terminated, true)
  assert.equal(canRetryFileSessionRecovery(missing, required), true)
  assert.equal(fileSessionRecoveryMethod(missing, required), 'create')

  const waiting = waitForFileSessionRecovery(
    beginFileSessionRecovery(required, missing.id, false),
    fileSession({ connection_generation: 3, state_seq: 1 }),
  )
  const failed = reconcileDisconnectedFileSessionRecovery(waiting, {
    ...missing,
    connection_generation: 3,
    state_seq: 2,
  })
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.terminated, true)
  assert.equal(canRetryFileSessionRecovery(missing, failed), true)
  assert.equal(fileSessionRecoveryMethod(missing, failed), 'create')
})

test('同一来源的并发手动恢复只执行一次实际请求', async () => {
  const pending = new Map<string, Promise<void>>()
  let starts = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const requests = Array.from({ length: 32 }, () => runSingleFileSessionRecovery(
    pending,
    'session-1',
    async () => {
      starts += 1
      await gate
    },
  ))

  assert.equal(starts, 1)
  assert.equal(new Set(requests).size, 1)
  release?.()
  await Promise.all(requests)
  assert.equal(pending.size, 0)
})

test('原地清理恢复事务不会破坏完成回收和后续重试', async () => {
  const pending = new Map<string, Promise<void>>()
  const original = pending
  let starts = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = runSingleFileSessionRecovery(pending, 'session-1', async () => {
    starts += 1
    await gate
  })

  pruneFileSessionRecoveries(pending, new Set(['session-1']))
  assert.equal(pending, original)
  assert.equal(pending.get('session-1'), first)
  release?.()
  await first
  assert.equal(pending.size, 0)

  await runSingleFileSessionRecovery(pending, 'session-1', async () => {
    starts += 1
  })
  assert.equal(starts, 2)
  assert.equal(pending.size, 0)
})

test('reconnect 返回会话不存在后，即使创建失败，下一次也直接创建', () => {
  const session = fileSession({ status: 'disconnected', phase: 'disconnected' })
  const required = requireFileSessionRecovery(idleFileSessionRecoveryState, session, false)
  const requesting = beginFileSessionRecovery(required, session.id, false)
  assert.equal(fileSessionRecoveryMethod(session, requesting), 'reconnect')

  const terminated = markFileSessionRecoveryTerminated(requesting, session.id)
  const failed = failFileSessionRecovery(terminated, 'SFTP_CONNECT_FAILED')
  assert.equal(failed.terminated, true)
  assert.equal(fileSessionRecoveryMethod(session, failed), 'create')
  assert.equal(fileSessionRecoveryPresentationKind(session, failed), 'recovery_failed')
})

test('恢复展示优先呈现失败，并在等待指纹时保留明确阶段', () => {
  const waitingTrust = fileSession({
    status: 'waiting_trust',
    phase: 'waiting_host_trust',
    connection_generation: 3,
  })
  const waitingRecovery = waitForFileSessionRecovery(
    beginFileSessionRecovery(idleFileSessionRecoveryState, waitingTrust.id, false),
    waitingTrust,
  )
  assert.equal(
    fileSessionRecoveryPresentationKind(waitingTrust, waitingRecovery),
    'waiting_trust',
  )

  const terminatedFailure = failFileSessionRecovery(
    markFileSessionRecoveryTerminated(waitingRecovery, waitingTrust.id),
    'SFTP_CONNECT_FAILED',
  )
  assert.equal(
    fileSessionRecoveryPresentationKind(waitingTrust, terminatedFailure),
    'recovery_failed',
  )
})

test('ready 被动提交会在执行时复核事务与当前权威会话', () => {
  const ready = fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 5,
    state_seq: 8,
  })
  const waiting = waitForFileSessionRecovery(
    beginFileSessionRecovery(idleFileSessionRecoveryState, ready.id, false),
    ready,
  )
  assert.equal(canCompleteFileSessionRecovery(
    waiting,
    waiting.transaction,
    ready.id,
    5,
    ready,
  ), true)
  assert.equal(canCompleteFileSessionRecovery(
    waiting,
    waiting.transaction + 1,
    ready.id,
    5,
    ready,
  ), false)

  const disconnected = fileSession({
    status: 'disconnected',
    phase: 'disconnected',
    connection_generation: 5,
    state_seq: 9,
  })
  const failed = reconcileDisconnectedFileSessionRecovery(waiting, disconnected)
  assert.equal(failed.phase, 'failed')
  assert.equal(canCompleteFileSessionRecovery(
    failed,
    waiting.transaction,
    ready.id,
    5,
    disconnected,
  ), false)
  assert.equal(canCompleteFileSessionRecovery(
    waiting,
    waiting.transaction,
    ready.id,
    5,
    disconnected,
  ), false)
  assert.equal(canCompleteFileSessionRecovery(
    waiting,
    waiting.transaction,
    ready.id,
    5,
    fileSession({
      status: 'connected',
      phase: 'ready',
      connection_generation: 6,
      state_seq: 1,
    }),
  ), false)
})
