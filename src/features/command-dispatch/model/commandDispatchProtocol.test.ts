import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeCommandDispatchOutputControl,
  decodeCommandDispatchLatestTaskEvent,
  decodeCommandDispatchTask,
  decodeCommandDispatchTaskEvent,
} from './commandDispatchProtocol.ts'

test('命令任务协议解码完整任务与单调 revision', () => {
  const task = decodeCommandDispatchTask(taskFixture(4))
  assert.equal(task.revision, 4)
  assert.equal(task.targets[0]?.input_lock.task_id, 'task-1')
  assert.equal(task.targets[0]?.output_stream.next_offset, '17')
  assert.equal(task.targets[0]?.output_stream.truncated, false)
  assert.equal(decodeCommandDispatchTaskEvent({
    type: 'command_dispatch_task_snapshot',
    task: taskFixture(4),
  })?.task.id, 'task-1')
})

test('全局命令任务事件接受首帧空快照与外部任务更新', () => {
  assert.deepEqual(decodeCommandDispatchLatestTaskEvent({
    type: 'command_dispatch_latest_snapshot',
    task: null,
  }), {
    type: 'command_dispatch_latest_snapshot',
    task: null,
  })
  assert.equal(decodeCommandDispatchLatestTaskEvent({
    type: 'command_dispatch_latest_update',
    task: taskFixture(5),
  })?.task?.revision, 5)
})

test('命令输出控制协议拒绝无效游标并接受缺口', () => {
  assert.equal(decodeCommandDispatchOutputControl({
    type: 'output_gap',
    reason: 'buffer_evicted',
    stream: streamFixture(),
  })?.type, 'output_gap')
  assert.throws(() => decodeCommandDispatchOutputControl({
    type: 'output_gap',
    reason: 'buffer_evicted',
    stream: { ...streamFixture(), resume_offset: '18' },
  }), /游标顺序/)
})

test('命令输出附着首帧读取 canonical 缺口与结束状态', () => {
  const attached = decodeCommandDispatchOutputControl({
    type: 'output_attached',
    task_id: 'task-1',
    session_id: 'session-1',
    target: taskFixture(4).targets[0],
    stream: streamFixture(),
    reason: 'buffer_evicted',
    ended: true,
  })
  assert.equal(attached?.type, 'output_attached')
  if (attached?.type !== 'output_attached') return
  assert.equal(attached.reason, 'buffer_evicted')
  assert.equal(attached.ended, true)
})

test('命令输出附着首帧兼容早期 gap_reason 字段', () => {
  const attached = decodeCommandDispatchOutputControl({
    type: 'output_attached',
    task_id: 'task-1',
    session_id: 'session-1',
    target: taskFixture(4).targets[0],
    stream: streamFixture(),
    gap_reason: 'offset_ahead',
    ended: false,
  })
  assert.equal(attached?.type === 'output_attached' ? attached.reason : undefined, 'offset_ahead')
})

test('运行中命令输出附着兼容省略 ended 并视为未结束', () => {
  const attached = decodeCommandDispatchOutputControl({
    type: 'output_attached',
    task_id: 'task-1',
    session_id: 'session-1',
    target: taskFixture(4).targets[0],
    stream: streamFixture(),
  })
  assert.equal(attached?.type === 'output_attached' ? attached.ended : undefined, false)
})

test('命令输出游标严格限制为 uint64 十进制', () => {
  assert.equal(decodeCommandDispatchOutputControl({
    type: 'output_gap',
    reason: 'offset_ahead',
    stream: {
      ...streamFixture(),
      next_offset: '18446744073709551615',
    },
  })?.type, 'output_gap')
  assert.throws(() => decodeCommandDispatchOutputControl({
    type: 'output_gap',
    reason: 'offset_ahead',
    stream: {
      ...streamFixture(),
      next_offset: '18446744073709551616',
    },
  }), /next_offset/)
})

function taskFixture(revision: number) {
  return {
    id: 'task-1',
    client_request_id: 'request-1',
    revision,
    scope: 'selected',
    command: 'uname -s',
    status: 'running',
    target_session_ids: ['session-1'],
    targets: [{
      session_id: 'session-1',
      index: 0,
      status: 'running',
      exit_code_known: false,
      input_lock: {
        locked: true,
        owner: 'command_dispatch',
        task_id: 'task-1',
      },
      output_stream: streamFixture(),
    }],
    total_targets: 1,
    completed_targets: 0,
    succeeded_targets: 0,
    failed_targets: 0,
    interrupted_targets: 0,
    rejected_targets: 0,
    unknown_targets: 0,
    interruptible: true,
    created_at: '2026-08-12T00:00:00Z',
  }
}

function streamFixture() {
  return {
    epoch: '00112233445566778899aabbccddeeff',
    oldest_offset: '0',
    next_offset: '17',
    resume_offset: '0',
    truncated: false,
  }
}
