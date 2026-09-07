import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession } from '#entities/file'
import {
  adoptSuppressedFileSessionRecoveryResult,
  cancelFileSessionRecoveryAttempt,
  canReuseFileSessionDirectoryCache,
  canRecoverFileSession,
  fileSessionDirectoryCacheOwner,
  fileSessionRecoveryOutcome,
  fileSessionRecoveryRequestMethod,
  filterSuppressedFileSessions,
  findFileSessionRecoveryAttempt,
  includeActiveFileSessionClosure,
  isFileSessionRecoverySupersededError,
  pruneRetiredFileSessionIds,
  resolveFileSessionClosure,
  runFileSessionRecoveryOperation,
  runQueuedFileSessionRecoveryOperation,
  selectActiveFileSessionAfterConnect,
  selectFileSessionCloseFallback,
  selectFileSessionForNavigation,
  selectFileSessionNavigationTarget,
  shouldCreateFileSessionAfterReconnect,
  cleanupSuppressedFileSessionRecoveryResult,
  suppressFileSessionRecoveryResult,
  supersedeFileSessionRecovery,
  supersedeQueuedFileSessionRecovery,
  terminatedFileSessionSnapshot,
  type FileSessionRecoveryAttempt,
} from '#entities/file'

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'fs-1',
    host_id: 'host-1',
    origin: 'app',
    source_session_id: 'ssh-1',
    status: 'disconnected',
    phase: 'disconnected',
    current_path: '/srv/app',
    started_at: '2026-07-23T00:00:00Z',
    ...overrides,
  }
}

test('普通断线先重连，仅明确不存在的旧 ID 直接创建替代会话', () => {
  assert.equal(fileSessionRecoveryRequestMethod(fileSession()), 'reconnect')
  assert.equal(fileSessionRecoveryRequestMethod(fileSession({
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
    retryable: false,
  })), 'create')
  assert.equal(fileSessionRecoveryRequestMethod(fileSession({
    ended_at: '2026-07-23T00:01:00Z',
  })), 'reconnect')
})

test('从工作站进入文件页时保留已关闭会话并禁止自动创建替代连接', () => {
  const closed = fileSession({ id: 'fs-closed' })
  const closures = {
    'ssh-1': {
      session: closed,
      phase: 'closed' as const,
    },
  }

  const target = selectFileSessionNavigationTarget([], closures, 'host-1', 'ssh-1')
  assert.equal(target?.id, closed.id)
  assert.equal(target?.error_code, 'SFTP_FILE_SESSION_NOT_FOUND')
  assert.equal(target?.retryable, true)

  const displayed = includeActiveFileSessionClosure([], closures, closed.id)
  assert.deepEqual(displayed, [target])
})

test('活动关闭快照不会污染其他文件页签且由真实替代会话接管', () => {
  const closed = fileSession({ id: 'fs-closed' })
  const replacement = fileSession({
    id: 'fs-new',
    status: 'connected',
    phase: 'ready',
  })
  const closures = {
    'ssh-1': {
      session: closed,
      phase: 'closed' as const,
    },
  }

  assert.equal(
    includeActiveFileSessionClosure([replacement], closures, replacement.id)[0],
    replacement,
  )
  assert.deepEqual(
    includeActiveFileSessionClosure([replacement], closures, 'unrelated'),
    [replacement],
  )
})

test('reconnect 仅在明确的会话不存在错误时降级为 create', () => {
  assert.equal(shouldCreateFileSessionAfterReconnect({
    code: 'SFTP_FILE_SESSION_NOT_FOUND',
  }), true)
  assert.equal(shouldCreateFileSessionAfterReconnect({ code: 'SFTP_CONNECT_FAILED' }), false)
  assert.equal(shouldCreateFileSessionAfterReconnect(new Error('network error')), false)
})

test('不可重试失败禁用恢复，但已终止旧 ID 始终允许创建替代会话', () => {
  assert.equal(canRecoverFileSession(fileSession({
    status: 'failed',
    phase: 'failed',
    retryable: false,
  })), false)
  assert.equal(canRecoverFileSession(fileSession({
    status: 'failed',
    phase: 'failed',
    retryable: false,
    error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
  })), true)
})

test('恢复事务按原 ID 和替代 ID 去重，并等待相同或更新代际终态', () => {
  const attempt: FileSessionRecoveryAttempt = {
    originalSessionId: 'fs-old',
    targetSessionId: 'fs-new',
    phase: 'waiting_ready',
    connectionGeneration: 4,
  }
  const attempts = new Map([['fs-old', attempt]])

  assert.equal(findFileSessionRecoveryAttempt(attempts, 'fs-old'), attempt)
  assert.equal(findFileSessionRecoveryAttempt(attempts, 'fs-new'), attempt)
  assert.equal(fileSessionRecoveryOutcome(attempt, fileSession({
    id: 'fs-new',
    status: 'connected',
    phase: 'ready',
    connection_generation: 3,
  })), 'pending')
  assert.equal(fileSessionRecoveryOutcome(attempt, fileSession({
    id: 'fs-new',
    status: 'connecting',
    phase: 'sftp_handshake',
    connection_generation: 4,
  })), 'pending')
  assert.equal(fileSessionRecoveryOutcome(attempt, fileSession({
    id: 'fs-new',
    status: 'connected',
    phase: 'ready',
    connection_generation: 4,
  })), 'succeeded')
  assert.equal(fileSessionRecoveryOutcome(attempt, fileSession({
    id: 'fs-new',
    status: 'failed',
    phase: 'failed',
    connection_generation: 4,
  })), 'failed')
})

test('断线和恢复换 ID 时复用最后目录缓存，但不串用无关会话', () => {
  const original = fileSession({
    id: 'fs-old',
    source_session_id: 'ssh-source',
    file_access_profile_id: 'file-profile-1',
    ssh_profile_id: 'ssh-profile-1',
  })
  const owner = fileSessionDirectoryCacheOwner(original)
  const replacement = fileSession({
    id: 'fs-new',
    source_session_id: 'ssh-source',
    file_access_profile_id: 'file-profile-1',
    ssh_profile_id: 'ssh-profile-1',
    status: 'connecting',
    phase: 'dialing',
  })

  assert.equal(canReuseFileSessionDirectoryCache(owner, original, new Map()), true)
  assert.equal(canReuseFileSessionDirectoryCache(owner, replacement, new Map()), true)
  assert.equal(canReuseFileSessionDirectoryCache(owner, fileSession({
    id: 'fs-other',
    source_session_id: 'ssh-other',
  }), new Map()), false)
  assert.equal(canReuseFileSessionDirectoryCache(owner, fileSession({
    id: 'fs-other-profile',
    source_session_id: 'ssh-source',
    file_access_profile_id: 'file-profile-2',
    ssh_profile_id: 'ssh-profile-1',
  }), new Map()), false)
  assert.equal(canReuseFileSessionDirectoryCache(owner, fileSession({
    id: 'fs-other-route',
    source_session_id: 'ssh-source',
    file_access_profile_id: 'file-profile-1',
    ssh_profile_id: 'ssh-profile-2',
  }), new Map()), false)
})

test('没有 source 的替代会话只通过同一恢复事务继承目录缓存', () => {
  const original = fileSession({
    id: 'fs-old',
    source_session_id: undefined,
  })
  const owner = fileSessionDirectoryCacheOwner(original)
  const replacement = fileSession({
    id: 'fs-new',
    source_session_id: undefined,
    status: 'connecting',
    phase: 'dialing',
  })
  const attempt: FileSessionRecoveryAttempt = {
    originalSessionId: original.id,
    targetSessionId: replacement.id,
    phase: 'waiting_ready',
  }

  assert.equal(
    canReuseFileSessionDirectoryCache(owner, replacement, new Map([[original.id, attempt]])),
    true,
  )
  assert.equal(canReuseFileSessionDirectoryCache(owner, replacement, new Map()), false)
})

test('closed 快照转换为可创建替代会话的稳定终态', () => {
  const closed = terminatedFileSessionSnapshot(fileSession({
    status: 'connected',
    phase: 'ready',
    progress: 100,
    state_seq: 8,
  }))

  assert.equal(closed.status, 'failed')
  assert.equal(closed.phase, 'failed')
  assert.equal(closed.progress, undefined)
  assert.equal(closed.error_code, 'SFTP_FILE_SESSION_NOT_FOUND')
  assert.equal(closed.retryable, true)
  assert.equal(closed.state_seq, 9)
})

test('显式关闭状态阻止工作站自动创建并允许新 ID 替代旧会话', () => {
  const original = fileSession({
    status: 'connected',
    phase: 'ready',
    progress: 100,
  })
  const closing = { session: original, phase: 'closing' as const }
  const closed = { session: original, phase: 'closed' as const }
  const replacement = fileSession({
    id: 'fs-2',
    status: 'connected',
    phase: 'ready',
  })

  assert.equal(resolveFileSessionClosure(null, closing), original)
  assert.equal(
    resolveFileSessionClosure(null, closed)?.error_code,
    'SFTP_FILE_SESSION_NOT_FOUND',
  )
  assert.equal(resolveFileSessionClosure(replacement, closed), replacement)
})

test('导航优先选择健康会话，但只有失效会话时仍保留给用户手动恢复', () => {
  const disconnected = fileSession({ id: 'fs-disconnected' })
  const connecting = fileSession({
    id: 'fs-connecting',
    status: 'connecting',
    phase: 'dialing',
  })
  const connected = fileSession({
    id: 'fs-connected',
    status: 'connected',
    phase: 'ready',
  })

  assert.equal(
    selectFileSessionForNavigation([disconnected, connecting, connected], 'host-1'),
    connected,
  )
  assert.equal(
    selectFileSessionForNavigation([disconnected], 'host-1'),
    disconnected,
  )
  assert.equal(selectFileSessionForNavigation([], 'host-1'), undefined)
})

test('独立 Files 入口只按文件 Profile 选会话，不依赖 Engine 私有路由', () => {
  const expected = fileSession({
    id: 'fs-default-profile',
    file_access_profile_id: 'file-default',
    ssh_profile_id: 'ssh-route-a',
    status: 'connected',
  })
  const otherProfile = fileSession({
    id: 'fs-other-profile',
    file_access_profile_id: 'file-other',
    ssh_profile_id: 'ssh-route-b',
    status: 'connected',
  })

  assert.equal(
    selectFileSessionForNavigation(
      [otherProfile, expected],
      'host-1',
      '',
      'file-default',
    ),
    expected,
  )
})

test('从 SSH 会话进入文件页时只选择相同 source，不被同主机健康会话替代', () => {
  const sourceDisconnected = fileSession({
    id: 'fs-source',
    source_session_id: 'ssh-target',
  })
  const otherConnected = fileSession({
    id: 'fs-other',
    source_session_id: 'ssh-other',
    status: 'connected',
    phase: 'ready',
  })

  assert.equal(
    selectFileSessionForNavigation(
      [otherConnected, sourceDisconnected],
      'host-1',
      'ssh-target',
    ),
    sourceDisconnected,
  )
})

test('close 先于迟到 reconnect 返回时，恢复结果被静默判定为 superseded', async () => {
  const closeEpochs = new Map<string, number>()
  let resolveReconnect: ((session: FileSession) => void) | undefined
  const reconnectResult = new Promise<FileSession>((resolve) => {
    resolveReconnect = resolve
  })
  const recovery = runFileSessionRecoveryOperation(
    closeEpochs,
    'fs-1',
    () => reconnectResult,
  )

  supersedeFileSessionRecovery(closeEpochs, 'fs-1')
  resolveReconnect?.(fileSession({
    status: 'connecting',
    phase: 'dialing',
    connection_generation: 4,
  }))

  await assert.rejects(recovery, isFileSessionRecoverySupersededError)
})

test('reconnect 先完成再 close 时，较新的 close 仍清除已经应用的恢复结果', async () => {
  const closeEpochs = new Map<string, number>()
  const recovered = fileSession({
    status: 'connected',
    phase: 'ready',
    connection_generation: 4,
  })

  let visibleSessions = [await runFileSessionRecoveryOperation(
    closeEpochs,
    recovered.id,
    async () => recovered,
  )]
  supersedeFileSessionRecovery(closeEpochs, recovered.id)
  visibleSessions = visibleSessions.filter((session) => session.id !== recovered.id)

  assert.deepEqual(visibleSessions, [])
})

test('create fallback 迟到时不复活旧标签并清理新建的替代会话', async () => {
  const closeEpochs = new Map<string, number>()
  const disposed: string[] = []
  let resolveCreate: ((session: FileSession) => void) | undefined
  const createResult = new Promise<FileSession>((resolve) => {
    resolveCreate = resolve
  })
  const recovery = runFileSessionRecoveryOperation(
    closeEpochs,
    'fs-old',
    () => createResult,
    async (session) => {
      disposed.push(session.id)
    },
  )

  supersedeFileSessionRecovery(closeEpochs, 'fs-old')
  resolveCreate?.(fileSession({
    id: 'fs-new',
    status: 'connecting',
    phase: 'dialing',
  }))

  await assert.rejects(recovery, isFileSessionRecoverySupersededError)
  assert.deepEqual(disposed, ['fs-new'])
})

test('close 期间 reconnect 返回不存在错误时，不会继续降级创建替代会话', async () => {
  const closeEpochs = new Map<string, number>()
  let rejectReconnect: ((error: unknown) => void) | undefined
  const reconnectResult = new Promise<FileSession>((_resolve, reject) => {
    rejectReconnect = reject
  })
  const recovery = runFileSessionRecoveryOperation(
    closeEpochs,
    'fs-1',
    () => reconnectResult,
  )

  supersedeFileSessionRecovery(closeEpochs, 'fs-1')
  rejectReconnect?.({ code: 'SFTP_FILE_SESSION_NOT_FOUND' })

  await assert.rejects(recovery, (error) => {
    assert.equal(isFileSessionRecoverySupersededError(error), true)
    assert.equal(shouldCreateFileSessionAfterReconnect(error), false)
    return true
  })
})

test('关闭标签会同时取消以原 ID 或替代 ID 等待的恢复事务', () => {
  const attempt: FileSessionRecoveryAttempt = {
    originalSessionId: 'fs-old',
    targetSessionId: 'fs-new',
    phase: 'waiting_ready',
  }

  const byOriginal = new Map([['fs-old', attempt]])
  assert.equal(cancelFileSessionRecoveryAttempt(byOriginal, 'fs-old'), true)
  assert.equal(byOriginal.size, 0)

  const byReplacement = new Map([['fs-old', attempt]])
  assert.equal(cancelFileSessionRecoveryAttempt(byReplacement, 'fs-new'), true)
  assert.equal(byReplacement.size, 0)
})

test('快速关闭真实与合成标签时只从当前未关闭会话选择回退目标', () => {
  const first = fileSession({ id: 'fs-first' })
  const second = fileSession({ id: 'fs-second' })
  const third = fileSession({ id: 'fs-third' })
  const synthetic = fileSession({ id: 'fs-synthetic', source_session_id: 'ssh-closed' })
  const closures = {
    'ssh-closed': {
      session: synthetic,
      phase: 'closed' as const,
    },
  }
  const unavailable = new Set(['fs-first', 'fs-second'])

  assert.equal(
    selectFileSessionCloseFallback([first, second, third], closures, unavailable),
    third.id,
  )
  unavailable.add(third.id)
  assert.equal(
    selectFileSessionCloseFallback([first, second, third], closures, unavailable),
    synthetic.id,
  )
  unavailable.add(synthetic.id)
  assert.equal(
    selectFileSessionCloseFallback([first, second, third], closures, unavailable),
    '',
  )
})

test('恢复创建替代会话时不会抢回用户已经切换的活动标签', () => {
  assert.equal(
    selectActiveFileSessionAfterConnect('fs-old', 'fs-new', 'fs-old'),
    'fs-new',
  )
  assert.equal(
    selectActiveFileSessionAfterConnect('fs-other', 'fs-new', 'fs-old'),
    'fs-other',
  )
  assert.equal(
    selectActiveFileSessionAfterConnect('fs-other', 'fs-new'),
    'fs-new',
  )
})

test('同一旧会话的下一轮恢复会等待 superseded cleanup 完成后才发出请求', async () => {
  const closeEpochs = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  let resolveOldRequest: ((session: FileSession) => void) | undefined
  let releaseCleanup: (() => void) | undefined
  let newRequestStarts = 0
  const oldRequest = new Promise<FileSession>((resolve) => {
    resolveOldRequest = resolve
  })
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve
  })
  const oldRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    () => oldRequest,
    async () => cleanupGate,
  )

  await Promise.resolve()
  supersedeFileSessionRecovery(closeEpochs, 'fs-old')
  resolveOldRequest?.(fileSession({ id: 'fs-created' }))
  const newRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    async () => {
      newRequestStarts += 1
      return fileSession({ id: 'fs-recovered' })
    },
  )
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(newRequestStarts, 0)
  assert.equal(pending.size, 1)

  releaseCleanup?.()
  await assert.rejects(oldRecovery, isFileSessionRecoverySupersededError)
  assert.equal((await newRecovery).id, 'fs-recovered')
  await Promise.resolve()
  assert.equal(newRequestStarts, 1)
  assert.equal(pending.size, 0)
})

test('排队等待旧 cleanup 期间再次 close 时，新恢复不会发出请求', async () => {
  const closeEpochs = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  let resolveOldRequest: ((session: FileSession) => void) | undefined
  let releaseCleanup: (() => void) | undefined
  let newRequestStarts = 0
  const oldRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    () => new Promise<FileSession>((resolve) => {
      resolveOldRequest = resolve
    }),
    () => new Promise<void>((resolve) => {
      releaseCleanup = resolve
    }),
  )

  await Promise.resolve()
  supersedeFileSessionRecovery(closeEpochs, 'fs-old')
  resolveOldRequest?.(fileSession({ id: 'fs-created' }))
  const newRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    async () => {
      newRequestStarts += 1
      return fileSession({ id: 'fs-never-started' })
    },
  )
  supersedeFileSessionRecovery(closeEpochs, 'fs-old')
  await Promise.resolve()
  await Promise.resolve()
  releaseCleanup?.()

  await assert.rejects(oldRecovery, isFileSessionRecoverySupersededError)
  await assert.rejects(newRecovery, isFileSessionRecoverySupersededError)
  await Promise.resolve()
  assert.equal(newRequestStarts, 0)
  assert.equal(pending.size, 0)
})

test('旧 cleanup 失败后释放队列，新恢复继续且不会再清理其结果', async () => {
  const closeEpochs = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  const suppressed = new Map<string, string>()
  const cleanupError = new Error('cleanup failed')
  let resolveOldRequest: ((session: FileSession) => void) | undefined
  let cleanupCalls = 0
  let newRequestStarts = 0
  const reused = fileSession({ id: 'fs-reused', status: 'connecting' })
  const oldRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    () => new Promise<FileSession>((resolve) => {
      resolveOldRequest = resolve
    }),
    async () => {
      cleanupCalls += 1
      suppressFileSessionRecoveryResult(suppressed, reused.id, 'fs-old')
      throw cleanupError
    },
  )

  await Promise.resolve()
  supersedeFileSessionRecovery(closeEpochs, 'fs-old')
  resolveOldRequest?.(reused)
  const newRecovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    async () => {
      newRequestStarts += 1
      return reused
    },
  )

  await assert.rejects(oldRecovery, (error) => {
    assert.equal(isFileSessionRecoverySupersededError(error), true)
    assert.equal(
      error instanceof Error && 'cleanupError' in error
        ? error.cleanupError
        : undefined,
      cleanupError,
    )
    return true
  })
  const recovered = await newRecovery
  adoptSuppressedFileSessionRecoveryResult(suppressed, recovered.id)
  assert.equal(recovered, reused)
  await Promise.resolve()
  assert.equal(cleanupCalls, 1)
  assert.equal(newRequestStarts, 1)
  assert.equal(suppressed.size, 0)
  assert.equal(pending.size, 0)
})

test('补偿删除失败的新 ID 被全量列表抑制，重试成功或恢复采用后解除', async () => {
  const suppressed = new Map<string, string>()
  const orphan = fileSession({ id: 'fs-orphan' })
  const healthy = fileSession({ id: 'fs-healthy' })
  suppressFileSessionRecoveryResult(suppressed, orphan.id, 'fs-old')

  assert.deepEqual(filterSuppressedFileSessions([orphan, healthy], suppressed), [healthy])
  await assert.rejects(
    cleanupSuppressedFileSessionRecoveryResult(
      suppressed,
      orphan.id,
      'fs-old',
      async () => {
        throw { code: 'SFTP_CONNECT_FAILED' }
      },
    ),
  )
  assert.deepEqual(filterSuppressedFileSessions([orphan], suppressed), [])

  await cleanupSuppressedFileSessionRecoveryResult(
    suppressed,
    orphan.id,
    'fs-old',
    async () => undefined,
  )
  assert.equal(suppressed.size, 0)
  assert.deepEqual(filterSuppressedFileSessions([orphan], suppressed), [orphan])

  suppressFileSessionRecoveryResult(suppressed, orphan.id, 'fs-old')
  adoptSuppressedFileSessionRecoveryResult(suppressed, orphan.id)
  assert.deepEqual(filterSuppressedFileSessions([orphan], suppressed), [orphan])
})

test('恢复队列 idle 后释放 close epoch，无排队请求的 close 不保留历史 ID', async () => {
  const closeEpochs = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  const recovery = runQueuedFileSessionRecoveryOperation(
    closeEpochs,
    pending,
    'fs-old',
    async () => fileSession(),
    undefined,
    (fileSessionId) => closeEpochs.delete(fileSessionId),
  )

  supersedeQueuedFileSessionRecovery(closeEpochs, pending, 'fs-old')
  await assert.rejects(recovery, isFileSessionRecoverySupersededError)
  await Promise.resolve()
  assert.equal(pending.size, 0)
  assert.equal(closeEpochs.size, 0)

  supersedeQueuedFileSessionRecovery(closeEpochs, pending, 'fs-without-request')
  assert.equal(closeEpochs.size, 0)
})

test('retired 文件标签仅保留实时会话或 closure 对应 ID', () => {
  const retired = new Set(['fs-live', 'fs-closure', 'fs-history'])
  const closure = fileSession({ id: 'fs-closure', source_session_id: 'ssh-closure' })

  pruneRetiredFileSessionIds(
    retired,
    [fileSession({ id: 'fs-live' })],
    {
      'ssh-closure': {
        session: closure,
        phase: 'closed',
      },
    },
  )
  assert.deepEqual([...retired].sort(), ['fs-closure', 'fs-live'])

  pruneRetiredFileSessionIds(retired, [], {})
  assert.equal(retired.size, 0)
})
