import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileOperationTask } from '#entities/file'
import type { FileOperationGateway } from './fileOperationGateway'
import { observeFileOperation } from './observeFileOperation'
import { useFileOperationWatcher } from './useFileOperationWatcher'

class FakeWebSocket {
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = 1
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  emit(type: string, event: unknown = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

function task(patch: Partial<FileOperationTask> = {}): FileOperationTask {
  return {
    id: 'operation-1',
    revision: 1,
    file_session_id: 'file-session-1',
    host_id: 'host-1',
    type: 'batch_rename',
    status: 'running',
    phase: 'rename',
    path: '/srv',
    total_bytes: 0,
    transferred_bytes: 0,
    remaining_bytes: 0,
    phase_total_bytes: 0,
    phase_transferred_bytes: 0,
    phase_progress_percent: 0,
    progress_percent: 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: true,
    created_at: '2026-08-21T00:00:00Z',
    ...patch,
  }
}

function api(fileOperation = vi.fn(async () => task())) {
  return {
    fileOperation,
    fileOperationEventsUrl: vi.fn(() => 'ws://localhost/file-operations'),
  } as unknown as FileOperationGateway
}

const originalWebSocket = globalThis.WebSocket

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  })
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: originalWebSocket,
  })
})

describe('文件操作共享观察器', () => {
  it('忽略陈旧 revision、保持进度单调并返回终态', async () => {
    const onTask = vi.fn()
    const observation = observeFileOperation({ api: api(), initialTask: task(), onTask })
    const socket = FakeWebSocket.instances[0]

    socket.emit('message', { data: JSON.stringify({
      type: 'file_operation_update',
      task: task({ revision: 2, progress_percent: 60 }),
    }) })
    socket.emit('message', { data: JSON.stringify({
      type: 'file_operation_update',
      task: task({ revision: 1, progress_percent: 10 }),
    }) })
    socket.emit('message', { data: JSON.stringify({
      type: 'file_operation_update',
      task: task({ revision: 3, status: 'completed', phase: 'done', progress_percent: 80 }),
    }) })

    await expect(observation.terminal).resolves.toEqual(expect.objectContaining({
      revision: 3,
      status: 'completed',
      progress_percent: 100,
    }))
    expect(onTask.mock.calls.map(([value]) => value.revision)).toEqual([1, 2, 3])
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('WebSocket 失败后通过轮询取得终态', async () => {
    const completed = task({ revision: 2, status: 'completed', phase: 'done', progress_percent: 100 })
    const fileOperation = vi.fn(async () => completed)
    const observation = observeFileOperation({ api: api(fileOperation), initialTask: task() })

    FakeWebSocket.instances[0].emit('error')
    await vi.advanceTimersByTimeAsync(250)

    await expect(observation.terminal).resolves.toEqual(completed)
    expect(fileOperation).toHaveBeenCalledWith('operation-1')
  })

  it('健康 WebSocket 更新会推迟兜底轮询', async () => {
    const fileOperation = vi.fn(async () => task({ revision: 2, progress_percent: 25 }))
    const observation = observeFileOperation({ api: api(fileOperation), initialTask: task() })
    const socket = FakeWebSocket.instances[0]

    await vi.advanceTimersByTimeAsync(1500)
    socket.emit('message', { data: JSON.stringify({
      type: 'file_operation_update',
      task: task({ revision: 2, progress_percent: 25 }),
    }) })
    await vi.advanceTimersByTimeAsync(600)
    expect(fileOperation).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1400)
    expect(fileOperation).toHaveBeenCalledTimes(1)
    observation.dispose()
    await expect(observation.terminal).resolves.toBeNull()
  })

  it('主动释放时关闭连接并以 null 结束等待', async () => {
    const observation = observeFileOperation({ api: api(), initialTask: task() })
    const socket = FakeWebSocket.instances[0]

    observation.dispose()

    await expect(observation.terminal).resolves.toBeNull()
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('旧观察器迟到结束时不会清除后来启动的任务', async () => {
    const cancelFileOperation = vi.fn(async (operationId: string) => {
      void operationId
    })
    const gateway = {
      ...api(),
      cancelFileOperation,
    } as unknown as FileOperationGateway
    const view = renderHook(() => useFileOperationWatcher({
      api: gateway,
      setOperationProgress: vi.fn(),
    }))

    let firstSettled: Promise<unknown> = Promise.resolve()
    let secondSettled: Promise<unknown> = Promise.resolve()
    act(() => {
      firstSettled = view.result.current.watchFileOperation(
        task({ id: 'operation-1' }),
        '读取文件',
        '读取完成',
        '读取失败',
      ).catch((error: unknown) => error)
      view.result.current.cancelActiveOperation()
      secondSettled = view.result.current.watchFileOperation(
        task({ id: 'operation-2' }),
        '读取文件',
        '读取完成',
        '读取失败',
      ).catch((error: unknown) => error)
    })

    await firstSettled
    act(() => view.result.current.cancelActiveOperation())
    await secondSettled

    expect(cancelFileOperation.mock.calls.map(([operationId]) => operationId)).toEqual([
      'operation-1',
      'operation-2',
    ])
    view.unmount()
  })
})
