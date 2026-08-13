import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommandDispatchTask } from '#entities/command-dispatch'
import {
  commandDispatchExitCodeDisplay,
  commandDispatchTaskMatchesInput,
  commandDispatchTaskReducer,
  createCommandDispatchTaskViewState,
  reconcileCommandDispatchTask,
} from './commandDispatchTaskState.ts'

test('命令任务 revision 对账拒绝旧快照与同 revision 终态回退', () => {
  const current = taskFixture(4, 'completed')
  assert.equal(reconcileCommandDispatchTask(current, taskFixture(3, 'running')), current)
  assert.equal(reconcileCommandDispatchTask(current, taskFixture(4, 'running')), current)
  assert.equal(reconcileCommandDispatchTask(current, taskFixture(5, 'running')).revision, 5)
})

test('旧任务中断回调不能保留已释放目标状态', () => {
  let state = commandDispatchTaskReducer(createCommandDispatchTaskViewState(), {
    type: 'snapshot',
    task: taskFixture(1, 'running'),
  })
  state = commandDispatchTaskReducer(state, {
    type: 'interrupt-target-start',
    sessionId: 'session-1',
  })
  state = commandDispatchTaskReducer(state, {
    type: 'snapshot',
    task: taskFixture(2, 'completed', false),
  })
  assert.equal(state.interruptingSessionIds.size, 0)
})

test('显式创建任务会接管并结束启动恢复状态', () => {
  let state = commandDispatchTaskReducer(createCommandDispatchTaskViewState(), {
    type: 'recover-start',
  })
  assert.equal(state.recovering, true)

  state = commandDispatchTaskReducer(state, { type: 'start-start' })
  assert.equal(state.recovering, false)
  assert.equal(state.starting, true)
})

test('Core 丢失内存任务后清理旧运行态并允许重新创建', () => {
  let state = commandDispatchTaskReducer(createCommandDispatchTaskViewState(), {
    type: 'snapshot',
    task: taskFixture(1, 'running'),
  })
  state = commandDispatchTaskReducer(state, {
    type: 'interrupt-target-start',
    sessionId: 'session-1',
  })
  state = commandDispatchTaskReducer(state, {
    type: 'task-lost',
    errorCode: 'COMMAND_DISPATCH_TASK_NOT_FOUND',
    errorMessage: '任务已不存在',
  })

  assert.equal(state.task, null)
  assert.equal(state.interruptingSessionIds.size, 0)
  assert.equal(state.interruptingTask, false)
  assert.equal(state.errorCode, 'COMMAND_DISPATCH_TASK_NOT_FOUND')
})

test('等待服务端完成中断时不依赖输入锁继续保留目标忙碌态', () => {
  let state = commandDispatchTaskReducer(createCommandDispatchTaskViewState(), {
    type: 'snapshot',
    task: taskFixture(1, 'running', false),
  })
  state = commandDispatchTaskReducer(state, {
    type: 'interrupt-target-start',
    sessionId: 'session-1',
  })
  state = commandDispatchTaskReducer(state, {
    type: 'snapshot',
    task: taskFixture(2, 'interrupting', false),
  })
  assert.deepEqual([...state.interruptingSessionIds], ['session-1'])
})

test('未知提交结果按完整幂等输入恢复，不误认内容相同或请求 ID 碰撞的任务', () => {
  const task = taskFixture(1, 'completed')
  assert.equal(commandDispatchTaskMatchesInput(task, {
    client_request_id: 'request-1',
    scope: task.scope,
    command: task.command,
    target_session_ids: [...task.target_session_ids],
  }), true)
  assert.equal(commandDispatchTaskMatchesInput(task, {
    client_request_id: 'different-request',
    scope: task.scope,
    command: task.command,
    target_session_ids: [...task.target_session_ids],
  }), false)
  assert.equal(commandDispatchTaskMatchesInput(task, {
    client_request_id: 'request-1',
    scope: 'all',
    command: task.command,
    target_session_ids: [...task.target_session_ids],
  }), false)
  assert.equal(commandDispatchTaskMatchesInput(task, {
    client_request_id: 'request-1',
    scope: task.scope,
    command: `${task.command} --help`,
    target_session_ids: [...task.target_session_ids],
  }), false)
  assert.equal(commandDispatchTaskMatchesInput(task, {
    client_request_id: 'request-1',
    scope: task.scope,
    command: task.command,
    target_session_ids: ['session-2'],
  }), false)
})

test('退出码只用于有权威退出状态的目标', () => {
  const target = taskFixture(1, 'running').targets[0]!
  assert.deepEqual(commandDispatchExitCodeDisplay({
    ...target,
    status: 'succeeded',
    exit_code_known: true,
    exit_code: 0,
  }), { kind: 'known', code: 0 })
  assert.deepEqual(commandDispatchExitCodeDisplay({
    ...target,
    status: 'completed_unknown',
  }), { kind: 'unknown' })
  for (const status of ['interrupted', 'rejected', 'disconnected', 'uncertain'] as const) {
    assert.equal(commandDispatchExitCodeDisplay({
      ...target,
      status,
      exit_code_known: false,
    }), null)
  }
})

function taskFixture(
  revision: number,
  status: CommandDispatchTask['status'],
  locked = true,
): CommandDispatchTask {
  return {
    id: 'task-1',
    client_request_id: 'request-1',
    revision,
    scope: 'current',
    command: 'uname -s',
    status,
    target_session_ids: ['session-1'],
    targets: [{
      session_id: 'session-1',
      index: 0,
      status: status === 'completed' ? 'succeeded' : 'running',
      exit_code_known: status === 'completed',
      exit_code: status === 'completed' ? 0 : undefined,
      input_lock: { locked, task_id: locked ? 'task-1' : undefined },
      output_stream: {
        epoch: '00112233445566778899aabbccddeeff',
        oldest_offset: '0',
        next_offset: '0',
        resume_offset: '0',
        truncated: false,
      },
    }],
    total_targets: 1,
    completed_targets: status === 'completed' ? 1 : 0,
    succeeded_targets: status === 'completed' ? 1 : 0,
    failed_targets: 0,
    interrupted_targets: 0,
    rejected_targets: 0,
    unknown_targets: 0,
    interruptible: status !== 'completed',
    created_at: '2026-08-12T00:00:00Z',
  }
}
