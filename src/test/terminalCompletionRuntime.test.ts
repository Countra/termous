import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalCompletionRuntime } from '../features/terminal/terminalCompletionRuntime.ts'

const boundary = {
  source_generation: 2,
  shell_id: 'shell-parent',
  prompt_generation: 5,
  shell: 'bash',
  cwd: '/srv/app',
  input_epoch: 8,
}

test('提示符边界按会话与代际建立补全基础状态', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyTransportState('session-1', 'live')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'waiting_prompt')

  assert.equal(runtime.applyPromptBoundary('session-1', boundary), true)
  assert.deepEqual(runtime.getSnapshot('session-1'), {
    sessionId: 'session-1',
    readiness: 'ready',
    boundary,
  })

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    source_generation: 1,
    prompt_generation: 99,
  }), false)
  assert.equal(runtime.getSnapshot('session-1').boundary?.source_generation, 2)
})

test('嵌套 Shell 按 input epoch 支持父子恢复并拒绝迟到边界', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyPromptBoundary('session-1', boundary)

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    shell_id: 'shell-child',
    prompt_generation: 1,
    cwd: '/srv/app/child',
    input_epoch: 9,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-child')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: 6,
  }), false)
  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: 6,
    input_epoch: 10,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-parent')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    shell_id: 'shell-child',
    prompt_generation: 2,
    cwd: '/srv/app/child',
    input_epoch: 9,
  }), false)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-parent')
})

test('重连、输出缺口和释放会话会清除旧提示符边界', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyTransportState('session-1', 'retry_wait')
  assert.deepEqual(runtime.getSnapshot('session-1'), {
    sessionId: 'session-1',
    readiness: 'unavailable',
    boundary: null,
  })

  runtime.applyPromptBoundary('session-1', boundary)
  runtime.setEnabled(false)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'disabled')

  runtime.setEnabled(true)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'ready')
  runtime.invalidateSession('session-1')
  assert.deepEqual(runtime.getSnapshot('session-1'), {
    sessionId: 'session-1',
    readiness: 'unavailable',
    boundary: null,
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.disposeSession('session-1')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)
})

test('关闭期间继续跟踪最新提示符，重新开启后无需等待下一条命令', () => {
  const runtime = new TerminalCompletionRuntime(false)
  runtime.applyTransportState('session-1', 'live')
  runtime.applyPromptBoundary('session-1', boundary)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'disabled')

  runtime.setEnabled(true)
  assert.deepEqual(runtime.getSnapshot('session-1'), {
    sessionId: 'session-1',
    readiness: 'ready',
    boundary,
  })
})
