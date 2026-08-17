import { expect, test, vi } from 'vitest'
import { TermousApiError } from '#shared/api'
import type { FileSession, FileSessionClosureState } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { Session } from '../model/sessionTypes'
import { initialData, sessionInventorySignature } from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'
import { createSessionCommands } from './sessionCommands'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-1',
    status: 'connected',
    started_at: '2026-08-08T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

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

function forward(overrides: Partial<ForwardInstance> = {}): ForwardInstance {
  return {
    id: 'forward-1',
    name: 'Forward 1',
    mode: 'local',
    scope: 'background_once',
    status: 'running',
    phase: 'ready',
    progress: 100,
    bind_host: '127.0.0.1',
    bind_port: 8022,
    target_host: '127.0.0.1',
    target_port: 22,
    active_connections: 0,
    total_connections: 0,
    bytes_in: 0,
    bytes_out: 0,
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

test('会话删除成功后才清理 inventory、关联文件会话和活动会话，并触发静默刷新', async () => {
  const closing = session()
  const fallback = session({ id: 'session-2', host_id: 'host-2' })
  const linkedFileSession = fileSession()
  let data = {
    ...structuredClone(initialData),
    sessions: [closing, fallback],
    fileSessions: [linkedFileSession],
  }
  let activeSession: Session | null = closing
  let closures: Record<string, FileSessionClosureState> = {
    [closing.id]: { session: linkedFileSession, phase: 'closed' as const },
  }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const request = deferred<void>()
  const sessionRevisions = new Map([[closing.id, 4]])
  const fileSessionRevisions = new Map([[linkedFileSession.id, 7]])
  const inventoryRequestRevisions = new Map([[closing.id, 2]])
  const inventoryEventRevisions = new Map([[closing.id, 3]])
  const inventorySignatures = new Map([[closing.id, sessionInventorySignature(closing)]])
  const supersedeRecovery = vi.fn()
  const load = vi.fn(async () => undefined)
  const commands = createSessionCommands({
    sessionApi: {
      createSession: vi.fn(),
      createLocalSession: vi.fn(),
      deleteSession: () => request.promise,
      refreshSessionInventory: vi.fn(),
    },
    fileSessionApi: { deleteFileSession: vi.fn() },
    forwardApi: { stopForward: vi.fn() },
    sessions: data.sessions,
    fileSessions: data.fileSessions,
    forwards: [],
    setData,
    setActiveSession: (update) => {
      activeSession = typeof update === 'function' ? update(activeSession) : update
    },
    setFileSessionClosures: (update) => {
      closures = typeof update === 'function' ? update(closures) : update
    },
    sessionEventRevisions: sessionRevisions,
    fileSessionEventRevisions: fileSessionRevisions,
    inventoryRequestRevisions,
    inventoryEventRevisions,
    inventoryStateSignatures: inventorySignatures,
    load,
    supersedeFileSessionRecoveryOperation: supersedeRecovery,
  })

  const mutation = commands.disconnect(closing.id)

  expect(data.sessions).toEqual([closing, fallback])
  expect(sessionRevisions.get(closing.id)).toBe(4)
  expect(supersedeRecovery).not.toHaveBeenCalled()

  request.resolve()
  await mutation

  expect(inventoryRequestRevisions.has(closing.id)).toBe(false)
  expect(inventoryEventRevisions.has(closing.id)).toBe(false)
  expect(inventorySignatures.has(closing.id)).toBe(false)
  expect(sessionRevisions.get(closing.id)).toBe(5)
  expect(fileSessionRevisions.get(linkedFileSession.id)).toBe(8)
  expect(supersedeRecovery).toHaveBeenCalledWith(linkedFileSession.id)
  expect(data.sessions).toEqual([fallback])
  expect(data.fileSessions).toEqual([])
  expect(closures).toEqual({})
  expect(activeSession).toBe(fallback)
  expect(load).toHaveBeenCalledWith('silent')
})

test('会话删除失败时不提前清理本地状态和 revision', async () => {
  const closing = session()
  const linkedFileSession = fileSession()
  const deleteError = new Error('delete failed')
  let data = {
    ...structuredClone(initialData),
    sessions: [closing],
    fileSessions: [linkedFileSession],
  }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const sessionRevisions = new Map([[closing.id, 1]])
  const fileSessionRevisions = new Map([[linkedFileSession.id, 2]])
  const inventoryRequestRevisions = new Map([[closing.id, 3]])
  const inventoryEventRevisions = new Map([[closing.id, 4]])
  const inventorySignatures = new Map([[closing.id, sessionInventorySignature(closing)]])
  const load = vi.fn(async () => undefined)
  const supersedeRecovery = vi.fn()
  const commands = createSessionCommands({
    sessionApi: {
      createSession: vi.fn(),
      createLocalSession: vi.fn(),
      deleteSession: async () => { throw deleteError },
      refreshSessionInventory: vi.fn(),
    },
    fileSessionApi: { deleteFileSession: vi.fn() },
    forwardApi: { stopForward: vi.fn() },
    sessions: data.sessions,
    fileSessions: data.fileSessions,
    forwards: [],
    setData,
    setActiveSession: vi.fn(),
    setFileSessionClosures: vi.fn(),
    sessionEventRevisions: sessionRevisions,
    fileSessionEventRevisions: fileSessionRevisions,
    inventoryRequestRevisions,
    inventoryEventRevisions,
    inventoryStateSignatures: inventorySignatures,
    load,
    supersedeFileSessionRecoveryOperation: supersedeRecovery,
  })

  await expect(commands.disconnect(closing.id)).rejects.toBe(deleteError)
  expect(data.sessions).toEqual([closing])
  expect(data.fileSessions).toEqual([linkedFileSession])
  expect(sessionRevisions.get(closing.id)).toBe(1)
  expect(fileSessionRevisions.get(linkedFileSession.id)).toBe(2)
  expect(inventoryRequestRevisions.get(closing.id)).toBe(3)
  expect(inventoryEventRevisions.get(closing.id)).toBe(4)
  expect(inventorySignatures.has(closing.id)).toBe(true)
  expect(supersedeRecovery).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

test('较新的 inventory 事件使失败请求稳定转换为 REQUEST_SUPERSEDED', async () => {
  const current = session({ inventory_status: 'collecting' })
  const request = deferred<Session>()
  let data = { ...structuredClone(initialData), sessions: [current] }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const inventoryEvents = new Map([[current.id, 5]])
  const commands = createSessionCommands({
    sessionApi: {
      createSession: vi.fn(),
      createLocalSession: vi.fn(),
      deleteSession: vi.fn(),
      refreshSessionInventory: () => request.promise,
    },
    fileSessionApi: { deleteFileSession: vi.fn() },
    forwardApi: { stopForward: vi.fn() },
    sessions: data.sessions,
    fileSessions: [],
    forwards: [forward()],
    setData,
    setActiveSession: vi.fn(),
    setFileSessionClosures: vi.fn(),
    sessionEventRevisions: new Map(),
    fileSessionEventRevisions: new Map(),
    inventoryRequestRevisions: new Map(),
    inventoryEventRevisions: inventoryEvents,
    inventoryStateSignatures: new Map(),
    load: vi.fn(),
    supersedeFileSessionRecoveryOperation: vi.fn(),
  })

  const mutation = commands.refreshSessionInventory(current.id)
  inventoryEvents.set(current.id, 6)
  request.reject(new Error('request failed'))

  await expect(mutation).rejects.toMatchObject({ code: 'REQUEST_SUPERSEDED' } satisfies Partial<TermousApiError>)
  expect(data.sessions).toEqual([current])
})

test('全部断开任一资源失败时保留本地快照且不触发静默刷新', async () => {
  const activeSession = session()
  const activeFileSession = fileSession()
  const activeForward = forward()
  const stoppedForward = forward({ id: 'forward-stopped', status: 'stopped' })
  const deleteError = new Error('delete session failed')
  let data = {
    ...structuredClone(initialData),
    sessions: [activeSession],
    fileSessions: [activeFileSession],
    forwards: [activeForward, stoppedForward],
  }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const deleteFileSession = vi.fn(async () => undefined)
  const stopForward = vi.fn(async () => undefined)
  const load = vi.fn(async () => undefined)
  const fileSessionRevisions = new Map<string, number>()
  const commands = createSessionCommands({
    sessionApi: {
      createSession: vi.fn(),
      createLocalSession: vi.fn(),
      deleteSession: async () => { throw deleteError },
      refreshSessionInventory: vi.fn(),
    },
    fileSessionApi: { deleteFileSession },
    forwardApi: { stopForward },
    sessions: data.sessions,
    fileSessions: data.fileSessions,
    forwards: data.forwards,
    setData,
    setActiveSession: vi.fn(),
    setFileSessionClosures: vi.fn(),
    sessionEventRevisions: new Map(),
    fileSessionEventRevisions: fileSessionRevisions,
    inventoryRequestRevisions: new Map([[activeSession.id, 1]]),
    inventoryEventRevisions: new Map([[activeSession.id, 2]]),
    inventoryStateSignatures: new Map([[activeSession.id, sessionInventorySignature(activeSession)]]),
    load,
    supersedeFileSessionRecoveryOperation: vi.fn(),
  })

  await expect(commands.disconnectAllConnections()).rejects.toBe(deleteError)

  expect(deleteFileSession).toHaveBeenCalledWith(activeFileSession.id)
  expect(stopForward).toHaveBeenCalledOnce()
  expect(stopForward).toHaveBeenCalledWith(activeForward.id)
  expect(data.sessions).toEqual([activeSession])
  expect(data.fileSessions).toEqual([activeFileSession])
  expect(data.forwards).toEqual([activeForward, stoppedForward])
  expect(fileSessionRevisions.get(activeFileSession.id)).toBe(1)
  expect(load).not.toHaveBeenCalled()
})
