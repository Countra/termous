import { act, renderHook } from '@testing-library/react'
import { expect, test, vi, type Mock } from 'vitest'
import type { FileSession, FileSessionClosureState } from '#entities/file'
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

type ConnectFileSession = (
  hostId: string,
  sourceSessionId?: string,
  initialPath?: string,
  replacedFileSessionId?: string,
) => Promise<FileSession>

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
  const connecting = harness.result.current.connectAndActivateFileSession(
    replaced.host_id,
    undefined,
    undefined,
    replaced.id,
  )
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
  await Promise.all([first, second])
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
  let closePromise!: Promise<void>
  act(() => {
    closePromise = harness.result.current.closeFileSession(active.id)
  })
  expect(harness.result.current.closingFileSessionIds).toEqual([active.id])

  await act(async () => request.resolve())
  await closePromise

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

  await act(() => harness.result.current.closeFileSession(active.id))

  expect(harness.onCloseError).toHaveBeenCalledWith(closeError)
  expect(harness.result.current.closingFileSessionIds).toEqual([])
})
