import { expect, test, vi } from 'vitest'
import type { FileSession, FileSessionClosureState } from '#entities/file'
import {
  isFileSessionRecoverySupersededError,
  supersedeQueuedFileSessionRecovery,
} from '#entities/file'
import { initialData } from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'
import { createFileSessionCommands } from './fileSessionCommands'

function fileSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: 'file-session-1',
    host_id: 'host-1',
    origin: 'app',
    source_session_id: 'session-1',
    status: 'connected',
    phase: 'ready',
    current_path: '/',
    started_at: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createStateHarness(sessions: FileSession[]) {
  let data = { ...structuredClone(initialData), fileSessions: sessions }
  let closures: Record<string, FileSessionClosureState> = {}
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  return {
    data: () => data,
    closures: () => closures,
    setData,
    setFileSessionClosures(update: Parameters<React.Dispatch<React.SetStateAction<Record<string, FileSessionClosureState>>>>[0]) {
      closures = typeof update === 'function' ? update(closures) : update
    },
  }
}

test('文件会话关闭在服务端确认前保持 closing，成功后再进入 closed 并移除实时快照', async () => {
  const closing = fileSession()
  const state = createStateHarness([closing])
  const request = deferred<void>()
  const revisions = new Map<string, number>()
  const closeSuppressions = new Set<string>()
  const supersedeRecovery = vi.fn()
  const commands = createFileSessionCommands({
    api: {
      createFileSession: vi.fn(),
      deleteFileSession: () => request.promise,
      reconnectFileSession: vi.fn(),
    },
    fileSessions: state.data().fileSessions,
    setData: state.setData,
    setFileSessionClosures: state.setFileSessionClosures,
    fileSessionRecoveryCloseEpochs: new Map(),
    fileSessionRecoveryQueues: new Map(),
    suppressedFileSessionIds: new Map(),
    closeSuppressedFileSessionIds: closeSuppressions,
    fileSessionEventRevisions: revisions,
    releaseFileSessionRecoveryEpoch: vi.fn(),
    scheduleSuppressedFileSessionCleanup: vi.fn(),
    supersedeFileSessionRecoveryOperation: supersedeRecovery,
  })

  const mutation = commands.closeFileSession(closing.id)

  expect(supersedeRecovery).toHaveBeenCalledWith(closing.id)
  expect(closeSuppressions.has(closing.id)).toBe(true)
  expect(revisions.get(closing.id)).toBe(1)
  expect(state.closures()[closing.source_session_id as string]).toEqual({
    session: closing,
    phase: 'closing',
  })
  expect(state.data().fileSessions).toEqual([closing])
  commands.updateFileSession({ ...closing, current_path: '/stale-frame' })
  expect(state.data().fileSessions).toEqual([closing])

  request.resolve()
  await mutation

  expect(revisions.get(closing.id)).toBe(2)
  expect(state.closures()[closing.source_session_id as string]).toEqual({
    session: closing,
    phase: 'closed',
  })
  expect(state.data().fileSessions).toEqual([])
  expect(closeSuppressions.has(closing.id)).toBe(true)
})

test('文件会话关闭失败时撤销 closing 标记并保留实时快照', async () => {
  const closing = fileSession()
  const state = createStateHarness([closing])
  const deleteError = new Error('delete failed')
  const revisions = new Map<string, number>()
  const closeSuppressions = new Set<string>()
  const commands = createFileSessionCommands({
    api: {
      createFileSession: vi.fn(),
      deleteFileSession: async () => { throw deleteError },
      reconnectFileSession: vi.fn(),
    },
    fileSessions: state.data().fileSessions,
    setData: state.setData,
    setFileSessionClosures: state.setFileSessionClosures,
    fileSessionRecoveryCloseEpochs: new Map(),
    fileSessionRecoveryQueues: new Map(),
    suppressedFileSessionIds: new Map(),
    closeSuppressedFileSessionIds: closeSuppressions,
    fileSessionEventRevisions: revisions,
    releaseFileSessionRecoveryEpoch: vi.fn(),
    scheduleSuppressedFileSessionCleanup: vi.fn(),
    supersedeFileSessionRecoveryOperation: vi.fn(),
  })

  await expect(commands.closeFileSession(closing.id)).rejects.toBe(deleteError)
  expect(revisions.get(closing.id)).toBe(1)
  expect(state.closures()).toEqual({})
  expect(state.data().fileSessions).toEqual([closing])
  expect(closeSuppressions.has(closing.id)).toBe(false)
})

test('显式关闭覆盖恢复创建后，补偿删除失败会保留抑制并登记后台重试', async () => {
  const replaced = fileSession({ id: 'file-session-old' })
  const orphan = fileSession({ id: 'file-session-orphan', status: 'connecting', phase: 'dialing' })
  const state = createStateHarness([replaced])
  const createRequest = deferred<FileSession>()
  const cleanupError = new Error('cleanup failed')
  const closeEpochs = new Map<string, number>()
  const queues = new Map<string, Promise<void>>()
  const suppressed = new Map<string, string>()
  const revisions = new Map<string, number>()
  const scheduleCleanup = vi.fn()
  const commands = createFileSessionCommands({
    api: {
      createFileSession: () => createRequest.promise,
      deleteFileSession: async () => { throw cleanupError },
      reconnectFileSession: vi.fn(),
    },
    fileSessions: state.data().fileSessions,
    setData: state.setData,
    setFileSessionClosures: state.setFileSessionClosures,
    fileSessionRecoveryCloseEpochs: closeEpochs,
    fileSessionRecoveryQueues: queues,
    suppressedFileSessionIds: suppressed,
    closeSuppressedFileSessionIds: new Set(),
    fileSessionEventRevisions: revisions,
    releaseFileSessionRecoveryEpoch: (id) => closeEpochs.delete(id),
    scheduleSuppressedFileSessionCleanup: scheduleCleanup,
    supersedeFileSessionRecoveryOperation: (id) => {
      supersedeQueuedFileSessionRecovery(closeEpochs, queues, id)
    },
  })

  const recovery = commands.connectFileSession({
    fileAccessProfileId: 'file-profile-1',
    sourceSessionId: 'session-1',
    initialPath: '/',
    replacedFileSessionId: replaced.id,
  })
  await Promise.resolve()
  supersedeQueuedFileSessionRecovery(closeEpochs, queues, replaced.id)
  createRequest.resolve(orphan)

  await expect(recovery).rejects.toSatisfy(isFileSessionRecoverySupersededError)
  expect(suppressed.get(orphan.id)).toBe(replaced.id)
  expect(scheduleCleanup).toHaveBeenCalledWith(orphan.id, replaced.id)
  expect(revisions.get(replaced.id)).toBe(1)
  expect(revisions.get(orphan.id)).toBe(1)
  expect(state.data().fileSessions).toEqual([replaced])
})
