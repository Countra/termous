import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  FileSession,
  RemoteDirectoryListing,
} from '#entities/file'
import type { FileSessionGateway } from '#features/files'
import { FilesWorkspaceRuntimeProvider } from '#widgets/files-workspace'
import {
  createRemoteDirectoryViewState,
  type FilesWorkspaceRuntimeState,
} from '../widgets/files-workspace/model/filesWorkspaceState'
import {
  useFilesDirectoryController,
  type FilesDirectoryLoadOptions,
} from '../widgets/files-workspace/model/useFilesDirectoryController'
import {
  useFilesWorkspaceRuntime,
  type FilesWorkspaceRuntimeValue,
} from '../widgets/files-workspace/model/useFilesWorkspaceRuntime'

interface DirectoryControllerValue {
  loadDirectory: (
    path: string,
    options?: FilesDirectoryLoadOptions,
  ) => Promise<boolean>
}

interface DirectoryHarnessProps {
  gateway: Pick<FileSessionGateway, 'listFileSessionFiles'>
  activeFileSession: FileSession | null
  fileSessions: readonly FileSession[]
  closingFileSessionIds?: ReadonlySet<string>
  recovering?: boolean
  mounted?: boolean
  initialStates?: FilesWorkspaceRuntimeState
  onController: (controller: DirectoryControllerValue) => void
  onRuntime: (runtime: FilesWorkspaceRuntimeValue) => void
  onInvalidPath?: () => void
  onDirectoryReadFailed?: (description: string) => void
  onActiveDirectoryCommitted?: () => void
}

function DirectoryHarness(props: DirectoryHarnessProps) {
  return (
    <FilesWorkspaceRuntimeProvider>
      <DirectoryHarnessBody {...props} />
    </FilesWorkspaceRuntimeProvider>
  )
}

function DirectoryHarnessBody({
  initialStates,
  mounted = true,
  onRuntime,
  ...props
}: DirectoryHarnessProps) {
  const runtime = useFilesWorkspaceRuntime()
  const [initialized, setInitialized] = useState(!initialStates)
  const initializedRef = useRef(!initialStates)

  useEffect(() => {
    onRuntime(runtime)
  }, [onRuntime, runtime])

  useEffect(() => {
    if (initializedRef.current || !initialStates) {
      return
    }
    initializedRef.current = true
    Object.entries(initialStates).forEach(([fileSessionId, state]) => {
      runtime.updateSession(
        fileSessionId,
        state.committedPath,
        () => state,
      )
    })
    setInitialized(true)
  }, [initialStates, runtime])

  return mounted && initialized
    ? <DirectoryControllerProbe runtime={runtime} {...props} />
    : null
}

function DirectoryControllerProbe({
  runtime,
  gateway,
  activeFileSession,
  fileSessions,
  closingFileSessionIds = emptyStringSet,
  recovering = false,
  onController,
  onInvalidPath = noop,
  onDirectoryReadFailed = noop,
  onActiveDirectoryCommitted = noop,
}: Omit<DirectoryHarnessProps, 'initialStates' | 'mounted' | 'onRuntime'> & {
  runtime: FilesWorkspaceRuntimeValue
}) {
  const activeFileSessionId = activeFileSession?.id ?? ''
  const fileSessionsRef = useRef(fileSessions)
  const workspaceStatesRef = useRef(runtime.states)
  const activeFileSessionIdRef = useRef(activeFileSessionId)
  const closingFileSessionIdsRef = useRef(closingFileSessionIds)
  fileSessionsRef.current = fileSessions
  workspaceStatesRef.current = runtime.states
  activeFileSessionIdRef.current = activeFileSessionId
  closingFileSessionIdsRef.current = closingFileSessionIds
  const { updateSession } = runtime

  const updateActiveSession = useCallback((
    updater: Parameters<FilesWorkspaceRuntimeValue['updateExistingSession']>[1],
  ) => {
    if (!activeFileSession) {
      return
    }
    updateSession(
      activeFileSession.id,
      activeFileSession.current_path || '/',
      updater,
    )
  }, [activeFileSession, updateSession])

  const controller = useFilesDirectoryController({
    gateway,
    activeFileSession,
    activeFileSessionId,
    activeFileSessionClosing: Boolean(
      activeFileSessionId && closingFileSessionIds.has(activeFileSessionId),
    ),
    activeFileSessionRecovering: recovering,
    fileSessions,
    closingFileSessionIds,
    fileSessionsRef,
    workspaceStatesRef,
    activeFileSessionIdRef,
    closingFileSessionIdsRef,
    updateSession: runtime.updateSession,
    updateExistingSession: runtime.updateExistingSession,
    updateActiveSession,
    clearDirectoryDirty: runtime.clearDirectoryDirty,
    isDirectoryDirty: runtime.isDirectoryDirty,
    unknownErrorMessage: 'unknown error',
    onInvalidPath,
    onDirectoryReadFailed,
    onActiveDirectoryCommitted,
  })

  useEffect(() => {
    onController(controller)
  }, [controller, onController])

  return null
}

const emptyStringSet: ReadonlySet<string> = new Set()
const noop = () => undefined

function fileSession(
  patch: Partial<FileSession> = {},
): FileSession {
  return {
    id: 'file-session-a',
    host_id: 'host-a',
    origin: 'app',
    status: 'connected',
    current_path: '/',
    started_at: '2026-08-08T00:00:00.000Z',
    connected_at: '2026-08-08T00:00:01.000Z',
    connection_generation: 1,
    ...patch,
  }
}

function directoryListing(path: string): RemoteDirectoryListing {
  return {
    host_id: 'host-a',
    file_session_id: 'file-session-a',
    path,
    parent_path: path === '/' ? '/' : '/',
    entries: [],
    read_at: '2026-08-08T00:00:02.000Z',
  }
}

function cachedDirectoryState(
  session: FileSession,
): FilesWorkspaceRuntimeState {
  return {
    [session.id]: {
      ...createRemoteDirectoryViewState(session.current_path || '/'),
      listing: directoryListing(session.current_path || '/'),
      lastLoadedAt: Date.now(),
      listingConnectionGeneration: session.connection_generation ?? 0,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function captureHarness() {
  const current: {
    controller: DirectoryControllerValue | null
    runtime: FilesWorkspaceRuntimeValue | null
  } = {
    controller: null,
    runtime: null,
  }
  return {
    current,
    onController: (controller: DirectoryControllerValue) => {
      current.controller = controller
    },
    onRuntime: (runtime: FilesWorkspaceRuntimeValue) => {
      current.runtime = runtime
    },
  }
}

async function waitForHarness(
  capture: ReturnType<typeof captureHarness>,
) {
  await waitFor(() => {
    expect(capture.current.controller).not.toBeNull()
    expect(capture.current.runtime).not.toBeNull()
  })
  return capture.current as {
    controller: DirectoryControllerValue
    runtime: FilesWorkspaceRuntimeValue
  }
}

describe('文件目录请求控制器合同', () => {
  it('严格模式首次挂载只发送一条有效目录请求', async () => {
    const session = fileSession()
    const gateway = {
      listFileSessionFiles: vi.fn(async () => directoryListing('/')),
    }
    const capture = captureHarness()

    render(
      <StrictMode>
        <DirectoryHarness
          gateway={gateway}
          activeFileSession={session}
          fileSessions={[session]}
          onController={capture.onController}
          onRuntime={capture.onRuntime}
        />
      </StrictMode>,
    )

    await waitForHarness(capture)
    await waitFor(() => expect(gateway.listFileSessionFiles).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(capture.current.runtime!.states[session.id]?.directoryStatus).toBe('idle')
      expect(capture.current.runtime!.states[session.id]?.listing?.path).toBe('/')
    })
  })

  it('连续请求会取消前一条，迟到结果不能覆盖当前目录', async () => {
    const session = fileSession()
    const requests: Array<ReturnType<typeof deferred<RemoteDirectoryListing>>> = []
    const signals: AbortSignal[] = []
    const gateway = {
      listFileSessionFiles: vi.fn((
        _fileSessionId: string,
        _path: string,
        options?: { signal?: AbortSignal },
      ) => {
        const request = deferred<RemoteDirectoryListing>()
        requests.push(request)
        if (options?.signal) {
          signals.push(options.signal)
        }
        return request.promise
      }),
    }
    const committed = vi.fn()
    const capture = captureHarness()
    render(
      <DirectoryHarness
        gateway={gateway}
        activeFileSession={session}
        fileSessions={[session]}
        initialStates={cachedDirectoryState(session)}
        onController={capture.onController}
        onRuntime={capture.onRuntime}
        onActiveDirectoryCommitted={committed}
      />,
    )
    const current = await waitForHarness(capture)
    let first!: Promise<boolean>
    act(() => {
      first = current.controller.loadDirectory('/first')
    })
    await waitFor(() => expect(gateway.listFileSessionFiles).toHaveBeenCalledTimes(1))
    let second!: Promise<boolean>
    act(() => {
      second = capture.current.controller!.loadDirectory('/second')
    })
    await waitFor(() => expect(gateway.listFileSessionFiles).toHaveBeenCalledTimes(2))
    expect(signals[0]?.aborted).toBe(true)
    let secondResult = false
    await act(async () => {
      requests[1]!.resolve(directoryListing('/second'))
      secondResult = await second
    })
    let firstResult = true
    await act(async () => {
      requests[0]!.resolve(directoryListing('/first'))
      firstResult = await first
    })
    expect(secondResult).toBe(true)
    expect(firstResult).toBe(false)
    expect(capture.current.runtime!.states[session.id]?.committedPath).toBe('/second')
    expect(committed).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: '连接代次变化',
      nextSession: fileSession({ connection_generation: 2 }),
      closingFileSessionIds: emptyStringSet,
      expectedStatus: 'idle' as const,
      prepareNextGenerationCache: true,
    },
    {
      name: '进入关闭状态',
      nextSession: fileSession(),
      closingFileSessionIds: new Set(['file-session-a']),
      expectedStatus: 'closing' as const,
      prepareNextGenerationCache: false,
    },
  ])('$name会取消旧请求并拒绝提交旧结果', async ({
    nextSession,
    closingFileSessionIds,
    expectedStatus,
    prepareNextGenerationCache,
  }) => {
    const session = fileSession()
    const request = deferred<RemoteDirectoryListing>()
    let signal: AbortSignal | undefined
    const gateway = {
      listFileSessionFiles: vi.fn((
        _fileSessionId: string,
        _path: string,
        options?: { signal?: AbortSignal },
      ) => {
        signal = options?.signal
        return request.promise
      }),
    }
    const committed = vi.fn()
    const capture = captureHarness()
    const harnessProps = {
      gateway,
      initialStates: cachedDirectoryState(session),
      onController: capture.onController,
      onRuntime: capture.onRuntime,
      onActiveDirectoryCommitted: committed,
    }
    const view = render(
      <DirectoryHarness
        {...harnessProps}
        activeFileSession={session}
        fileSessions={[session]}
      />,
    )
    const current = await waitForHarness(capture)
    let resultPromise!: Promise<boolean>
    act(() => {
      resultPromise = current.controller.loadDirectory('/generation-one')
    })
    await waitFor(() => expect(gateway.listFileSessionFiles).toHaveBeenCalledTimes(1))
    if (prepareNextGenerationCache) {
      act(() => {
        capture.current.runtime!.updateExistingSession(session.id, (state) => ({
          ...state,
          lastLoadedAt: Date.now(),
          listingConnectionGeneration: nextSession.connection_generation ?? 0,
        }))
      })
    }
    view.rerender(
      <DirectoryHarness
        {...harnessProps}
        activeFileSession={nextSession}
        fileSessions={[nextSession]}
        closingFileSessionIds={closingFileSessionIds}
      />,
    )

    await waitFor(() => expect(signal?.aborted).toBe(true))
    let result = true
    await act(async () => {
      request.resolve(directoryListing('/generation-one'))
      result = await resultPromise
    })
    expect(result).toBe(false)
    expect(committed).not.toHaveBeenCalled()
    expect(capture.current.runtime!.states[session.id]?.directoryStatus).toBe(expectedStatus)
  })

  it('页面卸载会取消请求并清除常驻运行时中的加载状态', async () => {
    const session = fileSession()
    const request = deferred<RemoteDirectoryListing>()
    let signal: AbortSignal | undefined
    const gateway = {
      listFileSessionFiles: vi.fn((
        _fileSessionId: string,
        _path: string,
        options?: { signal?: AbortSignal },
      ) => {
        signal = options?.signal
        return request.promise
      }),
    }
    const capture = captureHarness()
    const harnessProps = {
      gateway,
      activeFileSession: session,
      fileSessions: [session],
      initialStates: cachedDirectoryState(session),
      onController: capture.onController,
      onRuntime: capture.onRuntime,
    }
    const view = render(<DirectoryHarness {...harnessProps} />)
    const current = await waitForHarness(capture)

    let resultPromise!: Promise<boolean>
    act(() => {
      resultPromise = current.controller.loadDirectory('/pending')
    })
    await waitFor(() => {
      expect(capture.current.runtime!.states[session.id]?.activeRequest).not.toBeNull()
    })
    view.rerender(<DirectoryHarness {...harnessProps} mounted={false} />)

    await waitFor(() => {
      expect(signal?.aborted).toBe(true)
      expect(capture.current.runtime!.states[session.id]?.activeRequest).toBeNull()
    })
    expect(capture.current.runtime!.states[session.id]?.directoryStatus).toBe('idle')
    let result = true
    await act(async () => {
      request.resolve(directoryListing('/pending'))
      result = await resultPromise
    })
    expect(result).toBe(false)
  })

  it('保留定向错误回调、quiet 和默认通知的既有顺序', async () => {
    const session = fileSession()
    const gateway = {
      listFileSessionFiles: vi.fn(async () => {
        throw new Error('directory failed')
      }),
    }
    const events: string[] = []
    const capture = captureHarness()
    render(
      <DirectoryHarness
        gateway={gateway}
        activeFileSession={session}
        fileSessions={[session]}
        initialStates={cachedDirectoryState(session)}
        onController={capture.onController}
        onRuntime={capture.onRuntime}
        onDirectoryReadFailed={() => events.push('default')}
      />,
    )
    const current = await waitForHarness(capture)

    await act(async () => {
      await current.controller.loadDirectory('/quiet', {
        quiet: true,
        onError: () => events.push('specific'),
      })
    })
    expect(events).toEqual(['specific'])

    events.length = 0
    await act(async () => {
      await capture.current.controller!.loadDirectory('/loud', {
        onError: () => events.push('specific'),
      })
    })
    expect(events).toEqual(['specific', 'default'])
    expect(capture.current.runtime!.states[session.id]?.error).toBe('directory failed')
  })
})
