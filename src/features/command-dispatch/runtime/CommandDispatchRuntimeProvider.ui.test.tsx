import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandDispatchTask } from '#entities/command-dispatch'
import type { CommandDispatchGateway } from '../api/commandDispatchGateway'
import {
  useCommandDispatchRuntime,
  type CommandDispatchRuntimeContextValue,
} from './commandDispatchContext'
import { CommandDispatchRuntimeProvider } from './CommandDispatchRuntimeProvider'

describe('CommandDispatchRuntimeProvider 创建门禁', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('运行时配置未就绪时不恢复任务或建立事件连接', async () => {
    FakeWebSocket.sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const latestTask = vi.fn().mockResolvedValue(null)
    const gateway = createGateway({ latestTask })

    const view = render(
      <CommandDispatchRuntimeProvider api={gateway} enabled={false}>
        <RuntimeCapture onRuntime={() => undefined} />
      </CommandDispatchRuntimeProvider>,
    )
    await act(async () => Promise.resolve())

    expect(latestTask).not.toHaveBeenCalled()
    expect(FakeWebSocket.sockets).toHaveLength(0)

    view.rerender(
      <CommandDispatchRuntimeProvider api={gateway} enabled>
        <RuntimeCapture onRuntime={() => undefined} />
      </CommandDispatchRuntimeProvider>,
    )

    await waitFor(() => expect(latestTask).toHaveBeenCalledTimes(1))
    expect(FakeWebSocket.sockets).toHaveLength(1)
  })

  it('握手中的事件连接卸载后迟到建立不会再次请求任务', async () => {
    FakeWebSocket.sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const latestTask = vi.fn().mockResolvedValue(null)
    const gateway = createGateway({ latestTask })

    const view = render(
      <CommandDispatchRuntimeProvider api={gateway}>
        <RuntimeCapture onRuntime={() => undefined} />
      </CommandDispatchRuntimeProvider>,
    )
    await waitFor(() => expect(latestTask).toHaveBeenCalledTimes(1))
    const socket = FakeWebSocket.sockets[0]

    view.unmount()
    act(() => socket?.open())
    await act(async () => Promise.resolve())

    expect(latestTask).toHaveBeenCalledTimes(1)
  })

  it('恢复完成前拒绝发送，快速重复发送只创建一个任务', async () => {
    let resolveRecovery: (task: CommandDispatchTask | null) => void = () => undefined
    const latestTask = vi.fn(() => new Promise<CommandDispatchTask | null>((resolve) => {
      resolveRecovery = resolve
    }))
    const createTask = vi.fn().mockResolvedValue(taskFixture())
    const gateway = createGateway({ latestTask, createTask })
    let runtime: CommandDispatchRuntimeContextValue | null = null

    render(
      <CommandDispatchRuntimeProvider api={gateway}>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </CommandDispatchRuntimeProvider>,
    )
    await waitFor(() => expect(latestTask).toHaveBeenCalledTimes(1))

    await expect(runtime!.start(inputFixture())).rejects.toMatchObject({
      code: 'COMMAND_DISPATCH_TASK_RECOVERING',
    })
    expect(createTask).not.toHaveBeenCalled()

    await act(async () => resolveRecovery(null))
    await waitFor(() => expect(runtime!.state.recovering).toBe(false))
    const first = runtime!.start(inputFixture())
    const duplicate = runtime!.start(inputFixture())

    await expect(duplicate).rejects.toMatchObject({
      code: 'COMMAND_DISPATCH_TASK_STARTING',
    })
    await expect(first).resolves.toMatchObject({ id: 'task-1' })
    expect(createTask).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('创建响应丢失后按原请求 ID 恢复，禁止通过 latest 或重新创建猜测结果：%s', async (recoverable) => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const createTask = vi.fn().mockRejectedValue(new Error('连接已断开'))
    const latestTask = vi.fn()
    const tasks = vi.fn(async (options?: { clientRequestId?: string }) => ({
      revision: 1, items: recoverable && options?.clientRequestId === 'request-1' ? [taskFixture()] : [],
    }))
    const gateway = createGateway({ createTask, latestTask, tasks })
    let runtime: CommandDispatchRuntimeContextValue | null = null
    render(<CommandDispatchRuntimeProvider api={gateway}>
      <RuntimeCapture onRuntime={(value) => { runtime = value }} />
    </CommandDispatchRuntimeProvider>)
    await waitFor(() => expect(runtime!.state.recovering).toBe(false))
    await act(async () => {
      if (recoverable) await expect(runtime!.start(inputFixture())).resolves.toMatchObject({ id: 'task-1' })
      else await expect(runtime!.start(inputFixture())).rejects.toMatchObject({
        code: 'COMMAND_DISPATCH_RESULT_UNKNOWN', details: { client_request_id: 'request-1' },
      })
    })
    expect(createTask).toHaveBeenCalledTimes(1)
    expect(tasks).toHaveBeenCalledWith({ clientRequestId: 'request-1' })
    expect(latestTask).not.toHaveBeenCalled()
    if (!recoverable) expect(runtime!.state.errorCode).toBe('COMMAND_DISPATCH_RESULT_UNKNOWN')
  })

  it('稳定代际的权威空集合 GET 清理旧任务、输出和中断状态', async () => {
    FakeWebSocket.sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const currentTask = runningTaskFixture('task-running')
    let resolveFresh: (task: CommandDispatchTask | null) => void = () => undefined
    let resolveInterrupt: (task: CommandDispatchTask) => void = () => undefined
    const latestTask = vi.fn((options?: { fresh?: boolean }) => options?.fresh
      ? new Promise<CommandDispatchTask | null>((resolve) => { resolveFresh = resolve })
      : Promise.resolve(currentTask))
    const interruptTask = vi.fn(() => new Promise<CommandDispatchTask>((resolve) => {
      resolveInterrupt = resolve
    }))
    const gateway = createGateway({ latestTask, interruptTask })
    let runtime: CommandDispatchRuntimeContextValue | null = null

    render(
      <CommandDispatchRuntimeProvider api={gateway}>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </CommandDispatchRuntimeProvider>,
    )
    await waitFor(() => expect(runtime!.state.task?.id).toBe(currentTask.id))
    const retainedOutput = runtime!.getTargetOutputSnapshot(currentTask.id, 'session-1')
    let interruptPromise: Promise<CommandDispatchTask | null> | undefined
    act(() => {
      interruptPromise = runtime!.interruptTask()
    })
    expect(runtime!.state.interruptingTask).toBe(true)

    const latestSocket = FakeWebSocket.sockets.find((socket) => socket.url.includes('latest-events'))
    act(() => latestSocket?.open())
    await waitFor(() => expect(latestTask).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolveFresh(null)
      await Promise.resolve()
    })

    expect(runtime!.state.task).toBeNull()
    expect(runtime!.state.interruptingTask).toBe(false)
    expect(runtime!.getTargetOutputSnapshot(currentTask.id, 'session-1')).not.toBe(retainedOutput)
    await act(async () => {
      resolveInterrupt(currentTask)
      await interruptPromise
    })
    expect(runtime!.state.task).toBeNull()
  })

  it('稳定代际的 WebSocket 权威空首帧清理已恢复的旧任务', async () => {
    FakeWebSocket.sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const currentTask = taskFixture('task-completed')
    const gateway = createGateway({ latestTask: vi.fn().mockResolvedValue(currentTask) })
    let runtime: CommandDispatchRuntimeContextValue | null = null

    render(
      <CommandDispatchRuntimeProvider api={gateway}>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </CommandDispatchRuntimeProvider>,
    )
    await waitFor(() => expect(runtime!.state.task?.id).toBe(currentTask.id))
    const latestSocket = FakeWebSocket.sockets.find((socket) => socket.url.includes('latest-events'))

    act(() => latestSocket?.receive({
      type: 'command_dispatch_collection_snapshot', revision: 0, items: [],
    }))

    expect(runtime!.state.task).toBeNull()
  })

  it('拒绝旧集合覆盖本地新任务，后台任务不抢占当前选择', async () => {
    FakeWebSocket.sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    let resolveFresh: (task: CommandDispatchTask | null) => void = () => undefined
    const latestTask = vi.fn((options?: { fresh?: boolean }) => options?.fresh
      ? new Promise<CommandDispatchTask | null>((resolve) => { resolveFresh = resolve })
      : Promise.resolve(null))
    const currentTask = taskFixture('task-current', '2026-08-12T00:00:00.000000200Z')
    const staleTask = taskFixture('task-stale', '2026-08-12T00:00:00.000000100Z')
    const newerExternalTask = taskFixture('task-external', '2026-08-12T00:00:00.000000300Z')
    let reads = 0
    const gateway = createGateway({
      latestTask,
      tasks: async () => {
        if (++reads > 2) return { revision: 2, items: [currentTask] }
        const task = await latestTask({ fresh: reads > 1 })
        return { revision: 0, items: task ? [task] : [] }
      },
      createTask: vi.fn().mockResolvedValue(currentTask),
    })
    let runtime: CommandDispatchRuntimeContextValue | null = null

    render(
      <CommandDispatchRuntimeProvider api={gateway}>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </CommandDispatchRuntimeProvider>,
    )
    await waitFor(() => expect(runtime!.state.recovering).toBe(false))
    const socket = FakeWebSocket.sockets[0]
    expect(socket).toBeDefined()
    act(() => socket?.open())
    await waitFor(() => expect(latestTask).toHaveBeenCalledTimes(2))

    await act(async () => {
      await runtime!.start(inputFixture())
    })
    expect(runtime!.state.task?.id).toBe('task-current')

    await act(async () => {
      resolveFresh(staleTask)
      await Promise.resolve()
    })
    expect(runtime!.state.task?.id).toBe('task-current')

    act(() => socket?.receive({
      type: 'command_dispatch_collection_snapshot', revision: 0, items: [],
    }))
    expect(runtime!.state.task?.id).toBe('task-current')

    act(() => socket?.receive({
      type: 'command_dispatch_collection_snapshot', revision: 1, items: [staleTask],
    }))
    expect(runtime!.state.task?.id).toBe('task-current')

    act(() => socket?.receive({
      type: 'command_dispatch_collection_snapshot', revision: 2, items: [newerExternalTask, currentTask],
    }))
    expect(runtime!.state.task?.id).toBe('task-current')
    expect(runtime!.tasks.map(({ id }) => id)).toContain('task-external')
    act(() => runtime!.selectTask('task-external'))
    expect(runtime!.state.task?.id).toBe('task-external')
  })
})

class FakeWebSocket extends EventTarget {
  static readonly sockets: FakeWebSocket[] = []

  constructor(readonly url: string) {
    super()
    FakeWebSocket.sockets.push(this)
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  receive(value: unknown) {
    const event = new Event('message') as MessageEvent<string>
    Object.defineProperty(event, 'data', { value: JSON.stringify(value) })
    this.dispatchEvent(event)
  }
}

function RuntimeCapture({
  onRuntime,
}: {
  onRuntime: (runtime: CommandDispatchRuntimeContextValue) => void
}) {
  onRuntime(useCommandDispatchRuntime())
  return null
}

function createGateway(
  overrides: Partial<CommandDispatchGateway>,
): CommandDispatchGateway {
  const unsupported = vi.fn(() => Promise.reject(new Error('本测试不调用此接口')))
  let reads = 0
  return {
    createTask: unsupported,
    tasks: async () => { const task = await overrides.latestTask?.({ fresh: reads++ > 0 }); return { revision: 0, items: task ? [task] : [] } },
    tasksEventsUrl: () => "ws://termous.test/latest-events",
    latestTask: unsupported,
    task: unsupported,
    interruptTask: unsupported,
    interruptTarget: unsupported,
    latestTasksEventsUrl: () => 'ws://termous.test/latest-events',
    taskEventsUrl: () => 'ws://termous.test/events',
    targetOutputUrl: () => 'ws://termous.test/output',
    ...overrides,
  }
}

function inputFixture() {
  return {
    client_request_id: 'request-1',
    scope: 'current' as const,
    command: 'uname -s',
    target_session_ids: ['session-1'],
  }
}

function taskFixture(
  id = 'task-1',
  createdAt = '2026-08-12T00:00:00Z',
): CommandDispatchTask {
  return {
    id,
    client_request_id: 'request-1',
    revision: 2,
    scope: 'current',
    command: 'uname -s',
    status: 'completed',
    target_session_ids: ['session-1'],
    targets: [{
      session_id: 'session-1',
      index: 0,
      status: 'succeeded',
      input_lock: { locked: false },
      exit_code_known: true,
      exit_code: 0,
      output_stream: {
        epoch: '00112233445566778899aabbccddeeff',
        oldest_offset: '0',
        next_offset: '0',
        resume_offset: '0',
        truncated: false,
      },
    }],
    total_targets: 1,
    completed_targets: 1,
    succeeded_targets: 1,
    failed_targets: 0,
    interrupted_targets: 0,
    rejected_targets: 0,
    unknown_targets: 0,
    interruptible: false,
    created_at: createdAt,
    finished_at: '2026-08-12T00:00:01Z',
  }
}

function runningTaskFixture(id: string): CommandDispatchTask {
  const task = taskFixture(id)
  return {
    ...task,
    revision: 1,
    status: 'running',
    targets: task.targets.map((target) => ({
      ...target,
      status: 'running',
      input_lock: { locked: true, owner_task_id: id },
      exit_code_known: false,
      exit_code: undefined,
    })),
    completed_targets: 0,
    succeeded_targets: 0,
    interruptible: true,
    finished_at: undefined,
  }
}
