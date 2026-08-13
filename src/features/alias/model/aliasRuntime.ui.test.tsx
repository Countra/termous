import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AliasMutationResult,
  AliasSyncTask,
  AliasWorkspace,
  ShellAliasInput,
} from '#entities/alias'
import { TermousApiError } from '#shared/api'
import type { AliasGateway, AliasSessionContext } from './contracts'
import { useAliasSyncTask } from './useAliasSyncTask'
import { useSessionAliases } from './useSessionAliases'

const connectedSession: AliasSessionContext = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
  host_id: 'host-a',
}

const workspace: AliasWorkspace = {
  shell: 'bash',
  bridge_status: 'installed',
  items: [],
}

const aliasInput: ShellAliasInput = {
  name: 'll',
  command: 'ls -alF',
  description: '',
  enabled: true,
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = 0
  closeCalls = 0

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  close() {
    this.closeCalls += 1
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

describe('Alias 运行时合同', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('页面失活时取消只读加载', async () => {
    const pending = deferred<AliasWorkspace>()
    const sessionAliases = vi.fn<AliasGateway['sessionAliases']>(() => pending.promise)
    const api = { sessionAliases } as unknown as AliasGateway
    const view = renderHook(({ enabled }) => useSessionAliases({
      api,
      session: connectedSession,
      sessionIds: [connectedSession.id],
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionAliases).toHaveBeenCalledTimes(1))
    const signal = sessionAliases.mock.calls[0][1]?.signal as AbortSignal

    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)

    await act(async () => {
      pending.reject(new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0))
      await Promise.resolve()
    })
    expect(view.result.current.loading).toBe(false)
  })

  it('页面失活不会取消已经提交的别名写入', async () => {
    const pending = deferred<AliasMutationResult>()
    const sessionAliases = vi.fn<AliasGateway['sessionAliases']>().mockResolvedValue(workspace)
    const createSessionAlias = vi.fn<AliasGateway['createSessionAlias']>(() => pending.promise)
    const api = { createSessionAlias, sessionAliases } as unknown as AliasGateway
    const view = renderHook(({ enabled }) => useSessionAliases({
      api,
      session: connectedSession,
      sessionIds: [connectedSession.id],
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(view.result.current.workspace).toEqual(workspace))
    let mutationPromise: Promise<AliasMutationResult> | undefined
    act(() => {
      mutationPromise = view.result.current.createAlias(aliasInput)
    })
    await waitFor(() => expect(createSessionAlias).toHaveBeenCalledTimes(1))
    const signal = createSessionAlias.mock.calls[0][2]?.signal as AbortSignal

    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(false)

    const result: AliasMutationResult = {
      workspace: { ...workspace, items: [{
        id: 'alias-a',
        ...aliasInput,
        created_at: '2026-08-07T00:00:00Z',
        updated_at: '2026-08-07T00:00:00Z',
      }] },
      apply_status: 'reconnect_required',
    }
    await act(async () => {
      pending.resolve(result)
      await mutationPromise
    })
    expect(signal.aborted).toBe(false)
    expect(view.result.current.workspace).toEqual(result.workspace)
    expect(view.result.current.mutation).toBeNull()
    expect(view.result.current.reconnectRequired).toBe(true)
  })

  it('页面失活时终止运行中任务的轮询与 WebSocket 跟踪', async () => {
    const pending = deferred<AliasSyncTask>()
    const runningTask = createSyncTask({
      status: 'running',
      completed_targets: 0,
      succeeded_targets: 0,
      progress_percent: 10,
      cancellable: true,
      finished_at: undefined,
    })
    const activeAliasSyncTask = vi.fn<AliasGateway['activeAliasSyncTask']>()
      .mockResolvedValue(runningTask)
    const aliasSyncTask = vi.fn<AliasGateway['aliasSyncTask']>(() => pending.promise)
    const api = {
      activeAliasSyncTask,
      aliasSyncTask,
      aliasSyncTaskEventsUrl: (taskId: string) => `ws://core.test/${taskId}`,
    } as unknown as AliasGateway
    const view = renderHook(({ enabled }) => useAliasSyncTask({ api, enabled }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => expect(view.result.current.task?.id).toBe(runningTask.id))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    await waitFor(() => expect(aliasSyncTask).toHaveBeenCalledTimes(1))
    const signal = aliasSyncTask.mock.calls[0][1]?.signal as AbortSignal

    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    expect(socket.closeCalls).toBe(1)

    await act(async () => {
      pending.reject(new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0))
      await Promise.resolve()
    })
  })

  it('取消同步会等待跟踪事件给出的最终任务状态', async () => {
    const runningTask = createSyncTask({
      status: 'running',
      completed_targets: 0,
      succeeded_targets: 0,
      progress_percent: 20,
      cancellable: true,
      finished_at: undefined,
    })
    const cancellingTask = createSyncTask({
      revision: 2,
      status: 'cancelling',
      completed_targets: 0,
      succeeded_targets: 0,
      progress_percent: 20,
      cancellable: false,
      finished_at: undefined,
    })
    const terminalTask = createSyncTask({
      revision: 3,
      status: 'cancelled',
      completed_targets: 1,
      succeeded_targets: 0,
      cancelled_targets: 1,
      progress_percent: 100,
    })
    const cancelAliasSyncTask = vi.fn<AliasGateway['cancelAliasSyncTask']>()
      .mockResolvedValue(cancellingTask)
    const api = {
      activeAliasSyncTask: vi.fn<AliasGateway['activeAliasSyncTask']>()
        .mockResolvedValue(runningTask),
      aliasSyncTask: vi.fn<AliasGateway['aliasSyncTask']>()
        .mockResolvedValue(runningTask),
      aliasSyncTaskEventsUrl: (taskId: string) => `ws://core.test/${taskId}`,
      cancelAliasSyncTask,
    } as unknown as AliasGateway
    const view = renderHook(() => useAliasSyncTask({ api, enabled: true }))

    await waitFor(() => expect(view.result.current.task?.id).toBe(runningTask.id))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    let cancelPromise: Promise<AliasSyncTask | null> | undefined
    act(() => {
      cancelPromise = view.result.current.cancelAndWait()
    })
    await waitFor(() => expect(view.result.current.task?.status).toBe('cancelling'))

    act(() => {
      FakeWebSocket.instances[0].emit({
        type: 'alias_sync_task_update',
        task: terminalTask,
      })
    })

    await expect(cancelPromise).resolves.toEqual(terminalTask)
    expect(cancelAliasSyncTask).toHaveBeenCalledWith(runningTask.id)
    expect(view.result.current.task).toEqual(terminalTask)
  })

  it('创建结果不确定时只接管完全匹配的活动同步任务', async () => {
    const task = createSyncTask()
    const requestError = new TermousApiError('网络中断', 'NETWORK_ERROR', 0)
    const activeAliasSyncTask = vi.fn<AliasGateway['activeAliasSyncTask']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(task)
    const createSessionAliasSyncTask = vi.fn<AliasGateway['createSessionAliasSyncTask']>()
      .mockRejectedValue(requestError)
    const api = { activeAliasSyncTask, createSessionAliasSyncTask } as unknown as AliasGateway
    const view = renderHook(() => useAliasSyncTask({ api, enabled: true }))

    await waitFor(() => expect(view.result.current.recovering).toBe(false))
    let recovered: AliasSyncTask | null = null
    await act(async () => {
      recovered = await view.result.current.start('session-a', {
        alias_ids: ['alias-a'],
        target_host_ids: ['host-b'],
      })
    })

    expect(recovered).toEqual(task)
    expect(view.result.current.task).toEqual(task)
    expect(activeAliasSyncTask).toHaveBeenCalledTimes(2)
  })

  it('创建结果不确定时不会接管选择不匹配的活动任务', async () => {
    const requestError = new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
    const activeAliasSyncTask = vi.fn<AliasGateway['activeAliasSyncTask']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createSyncTask({ target_host_ids: ['host-other'] }))
    const createSessionAliasSyncTask = vi.fn<AliasGateway['createSessionAliasSyncTask']>()
      .mockRejectedValue(requestError)
    const api = { activeAliasSyncTask, createSessionAliasSyncTask } as unknown as AliasGateway
    const view = renderHook(() => useAliasSyncTask({ api, enabled: true }))

    await waitFor(() => expect(view.result.current.recovering).toBe(false))
    await act(async () => {
      await expect(view.result.current.start('session-a', {
        alias_ids: ['alias-a'],
        target_host_ids: ['host-b'],
      })).rejects.toBe(requestError)
    })

    expect(view.result.current.task).toBeNull()
    expect(view.result.current.errorCode).toBe('REQUEST_TIMEOUT')
  })
})

function createSyncTask(overrides: Partial<AliasSyncTask> = {}): AliasSyncTask {
  return {
    id: 'task-a',
    revision: 1,
    status: 'completed',
    source: { session_id: 'session-a', host_id: 'host-a' },
    alias_ids: ['alias-a'],
    target_host_ids: ['host-b'],
    targets: [],
    total_targets: 1,
    completed_targets: 1,
    succeeded_targets: 1,
    skipped_targets: 0,
    failed_targets: 0,
    cancelled_targets: 0,
    uncertain_targets: 0,
    progress_percent: 100,
    cancellable: false,
    created_at: '2026-08-07T00:00:00Z',
    finished_at: '2026-08-07T00:00:01Z',
    ...overrides,
  }
}
