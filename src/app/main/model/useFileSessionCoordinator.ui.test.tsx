import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi, type Mock } from 'vitest'
import type {
  FileSession,
  FileSessionClosureState,
  FileSessionConnectInput,
} from '#entities/file'
import { useFileSessionCoordinator } from './useFileSessionCoordinator'

function fileSession(id: string, overrides: Partial<FileSession> = {}): FileSession {
  return {
    id,
    host_id: `host-${id}`,
    origin: 'app',
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

type ConnectFileSession = (input: FileSessionConnectInput) => Promise<FileSession>

type CloseFileSession = (fileSessionId: string) => Promise<void>
type FileSessionIdCallback = (fileSessionId: string) => void
type ErrorCallback = (error: unknown) => void

function renderCoordinator(options: {
  fileSessions?: FileSession[]
  fileSessionClosures?: Record<string, FileSessionClosureState>
  connectFileSession?: Mock<ConnectFileSession>
  closeFileSession?: Mock<CloseFileSession>
  supersedeFileSessionRecovery?: Mock<FileSessionIdCallback>
  onCloseError?: Mock<ErrorCallback>
} = {}) {
  const connectFileSession = options.connectFileSession ?? vi.fn<ConnectFileSession>()
  const closeFileSession = options.closeFileSession
    ?? vi.fn<CloseFileSession>(async () => undefined)
  const supersedeFileSessionRecovery = options.supersedeFileSessionRecovery
    ?? vi.fn<FileSessionIdCallback>()
  const onCloseError = options.onCloseError ?? vi.fn<ErrorCallback>()
  return {
    ...renderHook(() => useFileSessionCoordinator({
      fileSessions: options.fileSessions ?? [],
      fileSessionClosures: options.fileSessionClosures ?? {},
      connectFileSession,
      closeFileSession,
      supersedeFileSessionRecovery,
      onCloseError,
    })),
    closeFileSession,
    connectFileSession,
    onCloseError,
    supersedeFileSessionRecovery,
  }
}

test('替换连接完成时不抢回用户已经切换的文件标签', async () => {
  const replaced = fileSession('replaced')
  const selected = fileSession('selected')
  const replacement = fileSession('replacement')
  const request = deferred<FileSession>()
  const harness = renderCoordinator({
    fileSessions: [replaced, selected],
    connectFileSession: vi.fn(() => request.promise),
  })

  await act(async () => undefined)
  const connecting = harness.result.current.connectAndActivateFileSession({
    hostId: replaced.host_id,
    replacedFileSessionId: replaced.id,
  })
  act(() => harness.result.current.activateFileSession(selected.id))
  await act(async () => request.resolve(replacement))
  await connecting

  expect(harness.result.current.activeFileSession?.id).toBe(selected.id)
})

test('外部 MCP 会话实时加入时不抢占当前文件标签', async () => {
  const active = fileSession('active')
  const external = fileSession('external', { origin: 'mcp' })
  const connectFileSession = vi.fn<ConnectFileSession>()
  const closeFileSession = vi.fn<CloseFileSession>(async () => undefined)
  const view = renderHook(
    ({ fileSessions }) => useFileSessionCoordinator({
      fileSessions,
      fileSessionClosures: {},
      connectFileSession,
      closeFileSession,
      supersedeFileSessionRecovery: vi.fn(),
      onCloseError: vi.fn(),
    }),
    { initialProps: { fileSessions: [active] } },
  )

  await act(async () => undefined)
  expect(view.result.current.activeFileSession?.id).toBe(active.id)
  view.rerender({ fileSessions: [active, external] })
  expect(view.result.current.activeFileSession?.id).toBe(active.id)
})

test('已关闭的本地快照只终止恢复并选择可用标签', async () => {
  const closed = fileSession('closed')
  const fallback = fileSession('fallback')
  const harness = renderCoordinator({
    fileSessions: [fallback],
    fileSessionClosures: {
      source: { session: closed, phase: 'closed' },
    },
  })

  await act(async () => undefined)
  act(() => harness.result.current.activateFileSession(closed.id))
  await act(() => harness.result.current.closeFileSession(closed.id))

  expect(harness.supersedeFileSessionRecovery).toHaveBeenCalledWith(closed.id)
  expect(harness.closeFileSession).not.toHaveBeenCalled()
  expect(harness.result.current.activeFileSession?.id).toBe(fallback.id)
})

test('同一文件会话的并发关闭请求只提交一次', async () => {
  const active = fileSession('active')
  const request = deferred<void>()
  const harness = renderCoordinator({
    fileSessions: [active],
    closeFileSession: vi.fn(() => request.promise),
  })

  await act(async () => undefined)
  const first = harness.result.current.closeFileSession(active.id)
  const second = harness.result.current.closeFileSession(active.id)
  expect(harness.closeFileSession).toHaveBeenCalledTimes(1)
  await act(async () => request.resolve())
  expect(await Promise.all([first, second])).toEqual([true, false])
  expect(harness.result.current.closingFileSessionIds).toEqual([])
})

test('真实关闭期间公开 closing 状态并在成功后切换到备用标签', async () => {
  const active = fileSession('active')
  const fallback = fileSession('fallback')
  const request = deferred<void>()
  const harness = renderCoordinator({
    fileSessions: [active, fallback],
    closeFileSession: vi.fn(() => request.promise),
  })

  await act(async () => undefined)
  let closePromise!: Promise<boolean>
  act(() => {
    closePromise = harness.result.current.closeFileSession(active.id)
  })
  expect(harness.result.current.closingFileSessionIds).toEqual([active.id])

  await act(async () => request.resolve())
  expect(await closePromise).toBe(true)

  expect(harness.result.current.activeFileSession?.id).toBe(fallback.id)
  expect(harness.result.current.closingFileSessionIds).toEqual([])
})

test('关闭失败会反馈错误并清理本地 closing 状态', async () => {
  const active = fileSession('active')
  const closeError = new Error('close failed')
  const harness = renderCoordinator({
    fileSessions: [active],
    closeFileSession: vi.fn(async () => { throw closeError }),
  })

  await act(async () => {
    expect(await harness.result.current.closeFileSession(active.id)).toBe(false)
  })

  expect(harness.onCloseError).toHaveBeenCalledWith(closeError)
  expect(harness.result.current.closingFileSessionIds).toEqual([])
})

function renderRestartCoordinator() {
  const original = fileSession('original', { file_access_profile_id: 'profile', source_session_id: 'ssh' })
  const other = fileSession('other')
  const replacement = { ...original, id: 'replacement' }
  const close = deferred<void>()
  const connect = deferred<FileSession>()
  const closeFileSession = vi.fn(() => close.promise)
  const connectFileSession = vi.fn<ConnectFileSession>(() => connect.promise)
  const onCloseError = vi.fn()
  const view = renderHook(() => {
    const [fileSessions, setFileSessions] = useState([original, other])
    return useFileSessionCoordinator({
      fileSessions,
      fileSessionClosures: {},
      closeFileSession: async (id) => {
        await closeFileSession()
        setFileSessions((current) => current.filter((session) => session.id !== id))
      },
      connectFileSession: async (input) => {
        const result = await connectFileSession(input)
        setFileSessions((current) => [...current, result])
        return result
      },
      supersedeFileSessionRecovery: vi.fn(),
      onCloseError,
    })
  })
  return { ...view, original, other, replacement, close, connect, closeFileSession, connectFileSession, onCloseError }
}

test('重启等待关闭成功后按原配置、目录和来源新建，并恢复活动标签', async () => {
  const harness = renderRestartCoordinator()
  let restart!: Promise<FileSession | null>
  act(() => { restart = harness.result.current.restartFileSession(harness.original, '/committed') })
  expect(harness.connectFileSession).not.toHaveBeenCalled()
  await act(async () => {
    expect(await harness.result.current.restartFileSession(harness.original, '/committed')).toBeNull()
  })
  expect(harness.closeFileSession).toHaveBeenCalledTimes(1)
  await act(async () => harness.close.resolve())
  expect(harness.connectFileSession).toHaveBeenCalledExactlyOnceWith({
    fileAccessProfileId: 'profile', sourceSessionId: 'ssh', initialPath: '/committed',
  })
  expect(harness.result.current.activeFileSession?.id).toBe(harness.other.id)
  await act(async () => { harness.connect.resolve(harness.replacement); await restart })
  expect(harness.result.current.activeFileSession?.id).toBe(harness.replacement.id)
  expect(harness.result.current.displayedFileSessions.map((session) => session.id)).toEqual(['other', 'replacement'])
})

test.each(['before', 'closing', 'connecting'] as const)('重启后台标签或在 %s 阶段切换后不抢回选择', async (stage) => {
  const harness = renderRestartCoordinator()
  if (stage === 'before') act(() => harness.result.current.activateFileSession(harness.other.id))
  let restart!: Promise<FileSession | null>
  act(() => { restart = harness.result.current.restartFileSession(harness.original, '/') })
  if (stage === 'closing') act(() => harness.result.current.activateFileSession(harness.other.id))
  await act(async () => harness.close.resolve())
  if (stage === 'connecting') act(() => harness.result.current.activateFileSession(harness.other.id))
  await act(async () => { harness.connect.resolve(harness.replacement); await restart })
  expect(harness.result.current.activeFileSession?.id).toBe(harness.other.id)
})

test('重启关闭失败只报告一次错误，保留原连接且不新建', async () => {
  const harness = renderRestartCoordinator()
  const error = new Error('close failed')
  let restart!: Promise<FileSession | null>
  act(() => { restart = harness.result.current.restartFileSession(harness.original, '/') })
  await act(async () => { harness.close.reject(error); expect(await restart).toBeNull() })
  expect(harness.onCloseError).toHaveBeenCalledExactlyOnceWith(error)
  expect(harness.connectFileSession).not.toHaveBeenCalled()
  expect(harness.result.current.activeFileSession?.id).toBe(harness.original.id)
  expect(harness.result.current.closingFileSessionIds).toEqual([])
})

test('重启新建失败向调用方返回错误，不伪造连接或抢占备用标签', async () => {
  const harness = renderRestartCoordinator()
  const error = new Error('connect failed')
  let restart!: Promise<FileSession | null>
  act(() => { restart = harness.result.current.restartFileSession(harness.original, '/') })
  await act(async () => harness.close.resolve())
  await act(async () => {
    const rejection = expect(restart).rejects.toBe(error)
    harness.connect.reject(error)
    await rejection
  })
  expect(harness.onCloseError).not.toHaveBeenCalled()
  expect(harness.result.current.activeFileSession?.id).toBe(harness.other.id)
  expect(harness.result.current.displayedFileSessions.map((session) => session.id)).toEqual(['other'])
})
