import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { TransferRuntimeProvider } from '#app/transfer-runtime'
import type { TransferTask } from '#entities/file'
import {
  useTransferRuntime,
  type TransferRuntimeApi,
  type TransferRuntimeValue,
} from '#features/transfers'

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  readonly url: string
  closeCalls = 0

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  message(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(data),
    }))
  }

  close() {
    this.closeCalls += 1
    this.dispatchEvent(new Event('close'))
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function remoteCopyTask(
  status: TransferTask['status'] = 'completed',
  patch: Partial<TransferTask> = {},
): TransferTask {
  return {
    id: 'remote-copy-fast',
    host_id: 'source-host',
    file_session_id: 'source-session',
    source_host_id: 'source-host',
    target_host_id: 'target-host',
    source_file_session_id: 'source-session',
    target_file_session_id: 'target-session',
    type: 'remote_copy',
    status,
    source_paths: ['/source/file.txt'],
    target_path: '/target',
    total_bytes: 1,
    transferred_bytes: status === 'completed' ? 1 : 0,
    remaining_bytes: status === 'completed' ? 0 : 1,
    total_files: 1,
    completed_files: status === 'completed' ? 1 : 0,
    progress_percent: status === 'completed' ? 100 : 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: status === 'queued' || status === 'running',
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-08-15T00:00:00Z',
    ...patch,
  }
}

describe('Transfer Runtime Provider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('同一 API 共享运行时，并按连接与快照顺序初始化，最后消费者释放后才关闭', async () => {
    const initialTransfers = deferred<[]>()
    const transfers = vi.fn(() => initialTransfers.promise)
    const api = {
      transfers,
      transferEventsUrl: () => 'ws://127.0.0.1/api/v1/transfers/events',
    } satisfies TransferRuntimeApi
    const latestValues = new Map<string, TransferRuntimeValue>()

    function Probe({ id }: { id: string }) {
      const runtime = useTransferRuntime()
      latestValues.set(id, runtime)
      return (
        <output data-testid={id}>
          {String(runtime.connected)}:{String(runtime.initialized)}
        </output>
      )
    }

    function Consumer({ id }: { id: string }) {
      return (
        <TransferRuntimeProvider api={api}>
          <Probe id={id} />
        </TransferRuntimeProvider>
      )
    }

    function Harness({ first, second }: { first: boolean; second: boolean }) {
      return (
        <>
          {first ? <Consumer id="first" /> : null}
          {second ? <Consumer id="second" /> : null}
        </>
      )
    }

    const view = render(<Harness first second />)

    expect(transfers).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(latestValues.get('first')).toBe(latestValues.get('second'))
    expect(screen.getByTestId('first')).toHaveTextContent('false:false')
    expect(screen.getByTestId('second')).toHaveTextContent('false:false')

    await act(async () => {
      FakeWebSocket.instances[0].open()
    })

    expect(transfers).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('first')).toHaveTextContent('true:false')
    expect(screen.getByTestId('second')).toHaveTextContent('true:false')

    await act(async () => {
      initialTransfers.resolve([])
      await initialTransfers.promise
    })

    expect(screen.getByTestId('first')).toHaveTextContent('true:true')
    expect(screen.getByTestId('second')).toHaveTextContent('true:true')
    expect(latestValues.get('first')).toBe(latestValues.get('second'))

    view.rerender(<Harness first={false} second />)
    expect(FakeWebSocket.instances[0].closeCalls).toBe(0)

    view.rerender(<Harness first={false} second={false} />)
    expect(FakeWebSocket.instances[0].closeCalls).toBe(0)

    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(FakeWebSocket.instances[0].closeCalls).toBe(1)
  })

  it('极快完成的跨主机复制会由两个 Surface 各自消费一次刷新事件', async () => {
    const api = {
      transfers: vi.fn(async () => []),
      transferEventsUrl: () => 'ws://127.0.0.1/api/v1/transfers/events',
    } satisfies TransferRuntimeApi
    const refreshed = {
      files: vi.fn(),
      workbench: vi.fn(),
    }
    let latestRuntime: TransferRuntimeValue | undefined

    function Probe({ surface }: { surface: 'files-workspace' | 'workbench-files' }) {
      const runtime = useTransferRuntime()
      latestRuntime = runtime
      const consumeRemoteCopyRefreshEvents = runtime.consumeRemoteCopyRefreshEvents
      const remoteCopyRefreshVersion = runtime.remoteCopyRefreshVersion
      useEffect(() => {
        consumeRemoteCopyRefreshEvents(surface).forEach((event) => {
          refreshed[surface === 'files-workspace' ? 'files' : 'workbench'](event)
        })
      }, [consumeRemoteCopyRefreshEvents, remoteCopyRefreshVersion, surface])
      return null
    }

    render(
      <TransferRuntimeProvider api={api}>
        <Probe surface="files-workspace" />
        <Probe surface="workbench-files" />
      </TransferRuntimeProvider>,
    )
    await act(async () => Promise.resolve())

    const completed = remoteCopyTask()
    act(() => latestRuntime?.upsertTransfer(completed))

    expect(refreshed.files).toHaveBeenCalledTimes(1)
    expect(refreshed.workbench).toHaveBeenCalledTimes(1)
    expect(refreshed.files).toHaveBeenCalledWith(expect.objectContaining({
      taskId: completed.id,
      targetFileSessionId: 'target-session',
      targetPath: '/target',
    }))

    act(() => latestRuntime?.upsertTransfer({ ...completed }))

    expect(refreshed.files).toHaveBeenCalledTimes(1)
    expect(refreshed.workbench).toHaveBeenCalledTimes(1)
  })

  it('首轮 WebSocket 历史终态只建立基线，初始化后的新终态才触发刷新', async () => {
    const historical = remoteCopyTask('completed', { id: 'remote-copy-history' })
    const initialTransfers = deferred<TransferTask[]>()
    const api = {
      transfers: vi.fn(() => initialTransfers.promise),
      transferEventsUrl: () => 'ws://127.0.0.1/api/v1/transfers/events',
    } satisfies TransferRuntimeApi
    const filesRefresh = vi.fn()
    const workbenchRefresh = vi.fn()

    function Probe({ surface }: { surface: 'files-workspace' | 'workbench-files' }) {
      const runtime = useTransferRuntime()
      const consumeRemoteCopyRefreshEvents = runtime.consumeRemoteCopyRefreshEvents
      const remoteCopyRefreshVersion = runtime.remoteCopyRefreshVersion
      useEffect(() => {
        consumeRemoteCopyRefreshEvents(surface).forEach((event) => {
          if (surface === 'files-workspace') {
            filesRefresh(event)
          } else {
            workbenchRefresh(event)
          }
        })
      }, [consumeRemoteCopyRefreshEvents, remoteCopyRefreshVersion, surface])
      return null
    }

    render(
      <TransferRuntimeProvider api={api}>
        <Probe surface="files-workspace" />
        <Probe surface="workbench-files" />
      </TransferRuntimeProvider>,
    )

    await act(async () => {
      FakeWebSocket.instances[0].open()
      FakeWebSocket.instances[0].message({
        type: 'transfer_update',
        task: historical,
      })
    })
    expect(filesRefresh).not.toHaveBeenCalled()
    expect(workbenchRefresh).not.toHaveBeenCalled()

    await act(async () => {
      initialTransfers.resolve([historical])
      await initialTransfers.promise
    })
    await act(async () => {
      FakeWebSocket.instances[0].message({
        type: 'transfer_update',
        task: historical,
      })
    })
    expect(filesRefresh).not.toHaveBeenCalled()
    expect(workbenchRefresh).not.toHaveBeenCalled()

    const completed = remoteCopyTask('completed', { id: 'remote-copy-new' })
    await act(async () => {
      FakeWebSocket.instances[0].message({
        type: 'transfer_update',
        task: completed,
      })
    })

    expect(filesRefresh).toHaveBeenCalledTimes(1)
    expect(workbenchRefresh).toHaveBeenCalledTimes(1)
    expect(filesRefresh).toHaveBeenCalledWith(expect.objectContaining({
      taskId: completed.id,
    }))
  })
})
