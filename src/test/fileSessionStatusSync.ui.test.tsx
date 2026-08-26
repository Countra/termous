import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSession } from '#entities/file'
import { TermousApiError } from '#shared/api'
import { useFileSessionStatusSync } from '../widgets/files-workspace/model/useFileSessionStatusSync'

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = 0
  closeCalls = 0

  constructor(url: string) {
    super()
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  close() {
    if (this.readyState === 3) {
      return
    }
    this.closeCalls += 1
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  disconnect() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

function fileSession(
  id: string,
  patch: Partial<FileSession> = {},
): FileSession {
  return {
    id,
    host_id: `host-${id}`,
    file_access_profile_id: `file-profile-${id}`,
    ssh_profile_id: `ssh-profile-${id}`,
    engine: 'sftp',
    namespace: 'posix',
    capabilities: ['browse'],
    origin: 'app',
    status: 'connected',
    phase: 'ready',
    current_path: '/',
    started_at: '2026-08-09T00:00:00.000Z',
    connected_at: '2026-08-09T00:00:01.000Z',
    connection_generation: 1,
    state_seq: 1,
    ...patch,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createGateway(
  getFileSession: (id: string) => Promise<FileSession> = async (id) => fileSession(id),
) {
  return {
    getFileSession: vi.fn(getFileSession),
    fileSessionEventsUrl: vi.fn((id: string) => `ws://termous.test/files/${id}`),
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('文件会话状态同步合同', () => {
  it('每个可用会话只建立一个事件流，关闭或终止后立即释放', () => {
    const first = fileSession('first')
    const second = fileSession('second')
    const gateway = createGateway()
    const onUpdateFileSession = vi.fn()
    const view = renderHook(
      ({ fileSessions, closingFileSessionIds }) => useFileSessionStatusSync({
        gateway,
        fileSessions,
        closingFileSessionIds,
        onUpdateFileSession,
      }),
      {
        initialProps: {
          fileSessions: [first, second],
          closingFileSessionIds: new Set<string>(),
        },
      },
    )

    expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
      'ws://termous.test/files/first',
      'ws://termous.test/files/second',
    ])
    FakeWebSocket.instances.forEach((socket) => socket.open())

    view.rerender({
      fileSessions: [
        first,
        fileSession('second', { error_code: 'SFTP_FILE_SESSION_NOT_FOUND' }),
      ],
      closingFileSessionIds: new Set(['first']),
    })

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances.map((socket) => socket.closeCalls)).toEqual([1, 1])
  })

  it('回调变化不重建事件流，并由最新回调接收合法消息', () => {
    const session = fileSession('first')
    const gateway = createGateway()
    const firstCallback = vi.fn()
    const nextCallback = vi.fn()
    const view = renderHook(
      ({ onUpdate }) => useFileSessionStatusSync({
        gateway,
        fileSessions: [session],
        closingFileSessionIds: new Set(),
        onUpdateFileSession: onUpdate,
      }),
      { initialProps: { onUpdate: firstCallback } },
    )
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    view.rerender({ onUpdate: nextCallback })
    socket.receive(JSON.stringify({ type: 'updated', session }))

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(firstCallback).not.toHaveBeenCalled()
    expect(nextCallback).toHaveBeenCalledWith(session)
  })

  it('事件身份不匹配时拒绝更新其他会话', () => {
    const gateway = createGateway()
    const onUpdateFileSession = vi.fn()
    renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [fileSession('first')],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    socket.receive(JSON.stringify({
      type: 'updated',
      session: fileSession('other'),
    }))

    expect(onUpdateFileSession).not.toHaveBeenCalled()
    expect(socket.closeCalls).toBe(1)
  })

  it('单会话事件为旧 Core 回填 app 来源并拒绝未知来源', () => {
    const gateway = createGateway()
    const onUpdateFileSession = vi.fn()
    renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [fileSession('first')],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    const legacySession = { ...fileSession('first') } as Partial<FileSession>
    delete legacySession.origin

    socket.receive(JSON.stringify({ type: 'updated', session: legacySession }))
    expect(onUpdateFileSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 'first',
      origin: 'app',
    }))

    socket.receive(JSON.stringify({
      type: 'updated',
      session: { ...legacySession, origin: 'external' },
    }))
    expect(onUpdateFileSession).toHaveBeenCalledTimes(1)
    expect(socket.closeCalls).toBe(1)
  })

  it('closed 事件转换为终止快照并停止当前事件流', () => {
    const session = fileSession('first', { state_seq: 7 })
    const gateway = createGateway()
    const onUpdateFileSession = vi.fn()
    renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [session],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    socket.receive(JSON.stringify({ type: 'closed', session }))

    expect(onUpdateFileSession).toHaveBeenCalledWith(expect.objectContaining({
      id: session.id,
      status: 'failed',
      phase: 'failed',
      error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
      state_seq: 8,
    }))
    expect(socket.closeCalls).toBe(1)
    vi.runAllTimers()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it.each([
    new TermousApiError(
      'missing',
      'SFTP_FILE_SESSION_NOT_FOUND',
      404,
    ),
    { code: 'SFTP_FILE_SESSION_NOT_FOUND' },
  ])('快照不存在时使用最新缓存标记终止并停止重连', async (missingError) => {
    const initial = fileSession('first', { status_message: 'initial' })
    const latest = fileSession('first', { status_message: 'latest', state_seq: 9 })
    const gateway = createGateway(async () => { throw missingError })
    const onUpdateFileSession = vi.fn()
    const view = renderHook(
      ({ fileSessions }) => useFileSessionStatusSync({
        gateway,
        fileSessions,
        closingFileSessionIds: new Set(),
        onUpdateFileSession,
      }),
      { initialProps: { fileSessions: [initial] } },
    )
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    socket.disconnect()
    view.rerender({ fileSessions: [latest] })

    await act(async () => vi.advanceTimersByTimeAsync(400))

    expect(onUpdateFileSession).toHaveBeenCalledWith(expect.objectContaining({
      id: latest.id,
      error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
      state_seq: 10,
    }))
    await act(async () => vi.runAllTimersAsync())
    expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('普通快照错误沿用既有退避对账并在成功后重订阅', async () => {
    const session = fileSession('first')
    const gateway = createGateway()
    gateway.getFileSession
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(session)
    const onUpdateFileSession = vi.fn()
    renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [session],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    socket.disconnect()

    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)

    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(gateway.getFileSession).toHaveBeenCalledTimes(2)
    expect(onUpdateFileSession).toHaveBeenCalledWith(session)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it.each(['connecting', 'waiting_trust'] as const)(
    '%s 会话会立即轮询，并每秒继续对账',
    async (status) => {
      const session = fileSession('first', { status, phase: 'dialing' })
      const gateway = createGateway(async () => session)
      const onUpdateFileSession = vi.fn()
      const view = renderHook(
        ({ currentSession }) => useFileSessionStatusSync({
          gateway,
          fileSessions: [currentSession],
          closingFileSessionIds: new Set(),
          onUpdateFileSession,
        }),
        { initialProps: { currentSession: session } },
      )

      await act(async () => Promise.resolve())
      expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
      expect(onUpdateFileSession).toHaveBeenCalledWith(session)

      await act(async () => vi.advanceTimersByTimeAsync(1_000))
      expect(gateway.getFileSession).toHaveBeenCalledTimes(2)

      view.rerender({ currentSession: fileSession('first') })
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(gateway.getFileSession).toHaveBeenCalledTimes(2)
    },
  )

  it('轮询返回其他会话的快照时不会更新状态', async () => {
    const session = fileSession('first', { status: 'connecting' })
    const gateway = createGateway(async () => fileSession('other'))
    const onUpdateFileSession = vi.fn()
    renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [session],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))

    await act(async () => Promise.resolve())

    expect(gateway.getFileSession).toHaveBeenCalledWith(session.id)
    expect(onUpdateFileSession).not.toHaveBeenCalled()
  })

  it('会话离开轮询集合后不会提交旧请求的迟到结果', async () => {
    const request = deferred<FileSession>()
    const session = fileSession('first', { status: 'connecting' })
    const gateway = createGateway(() => request.promise)
    const onUpdateFileSession = vi.fn()
    const view = renderHook(
      ({ currentSession }) => useFileSessionStatusSync({
        gateway,
        fileSessions: [currentSession],
        closingFileSessionIds: new Set(),
        onUpdateFileSession,
      }),
      { initialProps: { currentSession: session } },
    )

    expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
    view.rerender({ currentSession: fileSession('first') })
    await act(async () => request.resolve(fileSession('first')))

    expect(onUpdateFileSession).not.toHaveBeenCalled()
  })

  it('Hook 卸载后不会提交旧轮询请求的迟到结果', async () => {
    const request = deferred<FileSession>()
    const session = fileSession('first', { status: 'connecting' })
    const gateway = createGateway(() => request.promise)
    const onUpdateFileSession = vi.fn()
    const view = renderHook(() => useFileSessionStatusSync({
      gateway,
      fileSessions: [session],
      closingFileSessionIds: new Set(),
      onUpdateFileSession,
    }))

    expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => request.resolve(fileSession('first')))

    expect(onUpdateFileSession).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(gateway.getFileSession).toHaveBeenCalledTimes(1)
  })
})
