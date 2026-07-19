import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionCwdState } from '../types/domain.ts'
import { TerminalCwdRuntime } from '../features/terminal/terminalCwdRuntime.ts'

function cwdState(overrides: Partial<SessionCwdState> = {}): SessionCwdState {
  return {
    confirmed_path: '/root',
    state_seq: 1,
    revision: 1,
    source: 'terminal',
    capability: 'supported',
    shell: 'bash',
    shell_phase: 'prompt',
    prompt_generation: 1,
    source_generation: 7,
    ...overrides,
  }
}

test('服务端 CWD 状态按 state sequence 单调合并', () => {
  const runtime = new TerminalCwdRuntime()

  assert.equal(runtime.applyServerState('ses-1', cwdState({ state_seq: 0 })), true)
  assert.equal(runtime.applyServerState('ses-1', cwdState()), true)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/same-sequence',
  })), false)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/stale',
    state_seq: 0,
  })), false)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/root')

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/new-source',
    state_seq: 2,
    revision: 0,
    prompt_generation: 0,
    source_generation: 8,
  })), true)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/new-source')
})

test('目录请求 latest-wins 且只携带服务端基准 revision', () => {
  const runtime = new TerminalCwdRuntime()
  const requests: Array<{ path: string; baseRevision: number }> = []
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', (request) => {
    requests.push({ path: request.path, baseRevision: request.base_revision })
    return true
  })

  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/root/first')
  const second = runtime.requestDirectoryChange('ses-1', 'fil-1', '/root/second')

  assert.equal(first.status, 'queued')
  assert.equal(second.status, 'queued')
  assert.deepEqual(requests, [
    { path: '/root/first', baseRevision: 1 },
    { path: '/root/second', baseRevision: 1 },
  ])
  assert.equal(runtime.getSnapshot('ses-1').desired_path, undefined)
  assert.equal(runtime.getSnapshot('ses-1').revision, 1)
  assert.equal(runtime.getSnapshot('ses-1').pending_operation, undefined)
})

test('重复目录、unsupported 和未就绪 transport 不发送请求', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  assert.equal(
    runtime.requestDirectoryChange('ses-1', 'fil-1', '/root').status,
    'not_ready',
  )

  let calls = 0
  runtime.registerTransport('ses-1', () => {
    calls += 1
    return true
  })
  assert.equal(
    runtime.requestDirectoryChange('ses-1', 'fil-1', '/root').status,
    'already_current',
  )
  assert.equal(calls, 0)

  runtime.applyServerState('ses-2', cwdState({
    capability: 'unsupported',
    capability_cause: 'shell unsupported',
  }))
  assert.deepEqual(
    runtime.requestDirectoryChange('ses-2', 'fil-2', '/tmp'),
    { status: 'unsupported', reason: 'shell unsupported' },
  )
})

test('request_error 与服务端 CWD 状态分离并保留 last-good path', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)
  const result = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')

  assert.equal(result.status, 'queued')
  if (result.status !== 'queued') {
    assert.fail('目录切换请求应进入队列')
  }
  assert.equal(runtime.applyRequestError('ses-1', {
    operation_id: result.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  }), true)
  const state = runtime.getSnapshot('ses-1')
  assert.equal(state.confirmed_path, '/root')
  assert.equal(state.desired_path, undefined)
  assert.equal(state.pending_operation, undefined)
  assert.deepEqual(runtime.getRequestErrorSnapshot('ses-1'), {
    operation_id: result.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  })
})

test('过期 request_error 不会覆盖较新的目录请求结果', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)
  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/first')
  const second = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/second')

  assert.equal(first.status, 'queued')
  assert.equal(second.status, 'queued')
  if (first.status !== 'queued' || second.status !== 'queued') {
    assert.fail('目录切换请求应进入队列')
  }
  assert.equal(
    runtime.applyRequestError('ses-1', {
      operation_id: first.request.operation_id,
      code: 'STALE',
      retryable: false,
      message: '过期错误',
    }),
    false,
  )
  assert.equal(runtime.getRequestErrorSnapshot('ses-1'), null)
})

test('transport 抛出异常时不会留下伪 pending operation', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => {
    throw new Error('socket closed')
  })

  assert.equal(
    runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp').status,
    'not_ready',
  )
  assert.equal(runtime.getSnapshot('ses-1').pending_operation, undefined)
  assert.equal(runtime.getSnapshot('ses-1').desired_path, undefined)
})

test('销毁会话会释放 transport 与订阅状态', () => {
  const runtime = new TerminalCwdRuntime()
  let notifications = 0
  runtime.subscribe('ses-1', () => {
    runtime.getSnapshot('ses-1')
    notifications += 1
  })
  runtime.applyServerState('ses-1', cwdState())
  assert.equal(notifications, 1)

  runtime.removeSession('ses-1')
  assert.equal(runtime.getSnapshot('ses-1').capability, 'probing')
  assert.equal(notifications, 2)
})
