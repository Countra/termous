import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommandDispatchTask } from '#entities/command-dispatch'
import type { CommandDispatchGateway } from '../api/commandDispatchGateway'
import {
  useCommandDispatchRuntime,
  type CommandDispatchRuntimeContextValue,
} from './commandDispatchContext'
import { CommandDispatchRuntimeProvider } from './CommandDispatchRuntimeProvider'

describe('CommandDispatchRuntimeProvider 创建门禁', () => {
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
})

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
  return {
    createTask: unsupported,
    latestTask: unsupported,
    task: unsupported,
    interruptTask: unsupported,
    interruptTarget: unsupported,
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

function taskFixture(): CommandDispatchTask {
  return {
    id: 'task-1',
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
    created_at: '2026-08-12T00:00:00Z',
    finished_at: '2026-08-12T00:00:01Z',
  }
}
