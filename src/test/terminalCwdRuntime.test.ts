import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionCwdState } from '../types/domain.ts'
import { TerminalCwdRuntime } from '../features/terminal/model/terminalCwdRuntime.ts'

function cwdState(overrides: Partial<SessionCwdState> = {}): SessionCwdState {
  return {
    confirmed_path: '/root',
    state_seq: 1,
    refresh_seq: 0,
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

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/next-generation',
    state_seq: 0,
    revision: 0,
    prompt_generation: 0,
    source_generation: 9,
  })), true)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/older-generation',
    state_seq: 999,
    source_generation: 8,
  })), false)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/next-generation')
})

test('terminal transport 状态变化可订阅且重复状态不通知', () => {
  const runtime = new TerminalCwdRuntime()
  let notifications = 0
  runtime.subscribe('ses-1', () => {
    notifications += 1
  })

  assert.equal(runtime.getTransportStateSnapshot('ses-1'), 'idle')
  assert.equal(runtime.applyTransportState('ses-1', 'connecting'), true)
  assert.equal(runtime.getTransportStateSnapshot('ses-1'), 'connecting')
  assert.equal(notifications, 1)
  assert.equal(runtime.applyTransportState('ses-1', 'connecting'), false)
  assert.equal(notifications, 1)
  assert.equal(runtime.applyTransportState('ses-1', 'live'), true)
  assert.equal(runtime.getTransportStateSnapshot('ses-1'), 'live')
  assert.equal(notifications, 2)
})

test('目录请求发送后 transport 断线会释放本地在途门控', () => {
  const runtime = new TerminalCwdRuntime()
  const requests: string[] = []
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', (request) => {
    requests.push(request.operation_id)
    return true
  })
  runtime.applyTransportState('ses-1', 'live')

  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/first')
  assert.equal(first.status, 'queued')
  runtime.applyTransportState('ses-1', 'retry_wait')
  assert.equal(runtime.applyServerState('ses-1', cwdState()), false)
  runtime.applyTransportState('ses-1', 'live')

  const retry = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/first')
  assert.equal(retry.status, 'queued')
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0], requests[1])
})

test('嵌套 Shell 快照按 state sequence 合并并允许 prompt generation 重置', () => {
  const runtime = new TerminalCwdRuntime()
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/srv/parent',
    state_seq: 10,
    prompt_generation: 12,
    control_status: 'ready',
  })), true)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/srv/child',
    state_seq: 11,
    prompt_generation: 1,
    control_status: 'inactive',
  })), true)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/srv/child')
  assert.equal(runtime.getSnapshot('ses-1').prompt_generation, 1)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/srv/parent/returned',
    state_seq: 12,
    prompt_generation: 13,
    control_status: 'ready',
  })), true)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/srv/parent/returned')
})

test('source generation 前进会取消旧刷新关联并允许新事务', () => {
  const runtime = new TerminalCwdRuntime()
  let calls = 0
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true, () => {
    calls += 1
    return true
  })
  const stale = runtime.refreshDirectory('ses-1')
  assert.equal(stale.status, 'queued')
  if (stale.status !== 'queued') {
    assert.fail('首个刷新应创建事务')
  }

  runtime.applyServerState('ses-1', cwdState({
    state_seq: 0,
    refresh_seq: 0,
    revision: 0,
    prompt_generation: 0,
    source_generation: 8,
    refresh_request_id: 'server-new-generation',
    refresh_status: 'pending',
  }))
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: stale.requestId,
    code: 'CWD_STALE',
    retryable: false,
    message: '旧事务已失效',
  }), false)
  const current = runtime.refreshDirectory('ses-1')
  assert.equal(current.status, 'queued')
  if (current.status !== 'queued') {
    assert.fail('新 generation 应允许新刷新事务')
  }
  assert.notEqual(current.requestId, stale.requestId)
  assert.equal(calls, 2)
})

test('同一文件会话的目录请求串行发送并使用最新服务端 revision', () => {
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
  assert.equal(second.status, 'busy')
  assert.deepEqual(requests, [
    { path: '/root/first', baseRevision: 1 },
  ])
  assert.equal(runtime.getSnapshot('ses-1').desired_path, undefined)
  assert.equal(runtime.getSnapshot('ses-1').revision, 1)
  assert.equal(runtime.getSnapshot('ses-1').pending_operation, undefined)

  runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/root/first',
    state_seq: 2,
    revision: 2,
  }))
  const next = runtime.requestDirectoryChange('ses-1', 'fil-1', '/root/second')
  assert.equal(next.status, 'queued')
  assert.deepEqual(requests, [
    { path: '/root/first', baseRevision: 1 },
    { path: '/root/second', baseRevision: 2 },
  ])
})

test('同路径目录切换失败后重试会创建新的操作标识', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)

  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')
  assert.equal(first.status, 'queued')
  if (first.status !== 'queued') {
    assert.fail('首次目录切换应进入队列')
  }

  runtime.applyServerState('ses-1', cwdState({
    state_seq: 2,
    desired_path: '/tmp',
    revision: 2,
    pending_operation: {
      id: first.request.operation_id,
      file_session_id: 'fil-1',
      path: '/tmp',
      revision: 2,
      status: 'failed',
      error_code: 'CWD_TIMEOUT',
      error: '目录切换超时',
    },
  }))

  const retry = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')
  assert.equal(retry.status, 'queued')
  if (retry.status !== 'queued') {
    assert.fail('失败后的同路径重试应重新进入队列')
  }
  assert.notEqual(retry.request.operation_id, first.request.operation_id)
})

test('新的文件会话不会替换 SSH 会话中尚未结束的目录事务', () => {
  const runtime = new TerminalCwdRuntime()
  let calls = 0
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => {
    calls += 1
    return true
  })

  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')
  const replacement = runtime.requestDirectoryChange('ses-1', 'fil-2', '/tmp')

  assert.equal(first.status, 'queued')
  assert.equal(replacement.status, 'busy')
  assert.equal(calls, 1)
})

test('服务端已有 SSH 目录事务时不会因文件会话变化而重复发送', () => {
  const runtime = new TerminalCwdRuntime()
  let calls = 0
  runtime.applyServerState('ses-1', cwdState({
    desired_path: '/tmp/first',
    revision: 2,
    pending_operation: {
      id: 'op_server_pending',
      file_session_id: 'fil-1',
      path: '/tmp/first',
      revision: 2,
      status: 'publishing',
    },
  }))
  runtime.registerTransport('ses-1', () => {
    calls += 1
    return true
  })

  assert.deepEqual(
    runtime.requestDirectoryChange('ses-1', 'fil-2', '/tmp/second'),
    { status: 'busy' },
  )
  assert.equal(calls, 0)
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
    scope: 'cwd_change',
    request_id: result.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  }), true)
  const state = runtime.getSnapshot('ses-1')
  assert.equal(state.confirmed_path, '/root')
  assert.equal(state.desired_path, undefined)
  assert.equal(state.pending_operation, undefined)
  assert.deepEqual(runtime.getRequestErrorSnapshot('ses-1'), {
    scope: 'cwd_change',
    request_id: result.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  })
  const retry = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')
  assert.equal(retry.status, 'queued')
  if (retry.status !== 'queued') {
    assert.fail('可重试错误返回后应立即允许重新发送目录切换')
  }
  assert.notEqual(retry.request.operation_id, result.request.operation_id)
})

test('过期 request_error 不会覆盖较新的目录请求结果', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)
  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/first')
  assert.equal(first.status, 'queued')
  if (first.status !== 'queued') {
    assert.fail('首次目录切换请求应进入队列')
  }
  runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/tmp/first',
    state_seq: 2,
    revision: 2,
  }))
  const second = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp/second')

  assert.equal(second.status, 'queued')
  if (second.status !== 'queued') {
    assert.fail('目录切换请求应进入队列')
  }
  assert.equal(
    runtime.applyRequestError('ses-1', {
      scope: 'cwd_change',
      request_id: first.request.operation_id,
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

test('目录刷新仅在服务端支持且刷新 transport 就绪时发送', () => {
  const runtime = new TerminalCwdRuntime()
  const refreshRequestIds: string[] = []
  let refreshCalls = 0

  assert.deepEqual(runtime.refreshDirectory('ses-1'), { status: 'not_ready' })
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)
  assert.deepEqual(runtime.refreshDirectory('ses-1'), { status: 'not_ready' })

  const unregister = runtime.registerTransport(
    'ses-1',
    () => true,
    (requestId) => {
      refreshCalls += 1
      refreshRequestIds.push(requestId)
      return true
    },
  )
  const queued = runtime.refreshDirectory('ses-1')
  assert.equal(queued.status, 'queued')
  if (queued.status !== 'queued') {
    assert.fail('目录刷新请求应进入队列')
  }
  assert.match(queued.requestId, /^cwd-refresh-/)
  assert.equal(queued.baseRefreshSequence, 0)
  assert.equal(queued.baseSourceGeneration, 7)
  assert.equal(queued.baseConfirmedPath, '/root')
  assert.deepEqual(refreshRequestIds, [queued.requestId])
  assert.equal(refreshCalls, 1)
  unregister()
  assert.deepEqual(runtime.refreshDirectory('ses-1'), { status: 'not_ready' })

  runtime.applyServerState('ses-2', cwdState({
    capability: 'unsupported',
    capability_cause: 'shell unsupported',
  }))
  runtime.registerTransport('ses-2', () => true, () => {
    refreshCalls += 1
    return true
  })
  assert.deepEqual(runtime.refreshDirectory('ses-2'), { status: 'not_ready' })

  runtime.applyServerState('ses-3', cwdState({ shell_phase: 'running' }))
  runtime.registerTransport('ses-3', () => true, () => {
    refreshCalls += 1
    return true
  })
  assert.deepEqual(runtime.refreshDirectory('ses-3'), { status: 'not_ready' })

  runtime.applyServerState('ses-inactive', cwdState({
    capability: 'probing',
    control_status: 'inactive',
  }))
  runtime.registerTransport('ses-inactive', () => true, () => {
    refreshCalls += 1
    return true
  })
  assert.equal(runtime.refreshDirectory('ses-inactive').status, 'queued')

  runtime.applyServerState('ses-4', cwdState({
    desired_path: '/srv',
    revision: 2,
    pending_operation: {
      id: 'cwd-pending',
      file_session_id: 'fil-pending',
      path: '/srv',
      revision: 2,
      status: 'applying',
    },
  }))
  runtime.registerTransport('ses-4', () => true, () => {
    refreshCalls += 1
    return true
  })
  assert.deepEqual(runtime.refreshDirectory('ses-4'), { status: 'not_ready' })
  assert.equal(refreshCalls, 2)

  runtime.applyServerState('ses-5', cwdState({
    desired_path: '/srv',
    revision: 2,
    pending_operation: {
      id: 'cwd-failed',
      file_session_id: 'fil-failed',
      path: '/srv',
      revision: 2,
      status: 'failed',
      error: '目录切换失败',
    },
  }))
  runtime.registerTransport('ses-5', () => true, () => {
    refreshCalls += 1
    return true
  })
  assert.equal(runtime.refreshDirectory('ses-5').status, 'queued')
  assert.equal(refreshCalls, 3)
})

test('目录刷新在首次实际发送时原子捕获当前服务端基线', () => {
  const runtime = new TerminalCwdRuntime()
  let calls = 0
  runtime.applyServerState('ses-1', cwdState({
    confirmed_path: undefined,
    state_seq: 0,
    refresh_seq: 0,
    source_generation: 0,
    capability: 'probing',
    control_status: 'inactive',
  }))
  runtime.registerTransport('ses-1', () => true)

  assert.deepEqual(runtime.refreshDirectory('ses-1'), { status: 'not_ready' })
  assert.equal(calls, 0)

  runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/srv/ready',
    state_seq: 0,
    refresh_seq: 4,
    source_generation: 7,
    capability: 'supported',
    control_status: 'ready',
  }))
  runtime.registerTransport('ses-1', () => true, () => {
    calls += 1
    return true
  })
  const queued = runtime.refreshDirectory('ses-1')
  assert.equal(queued.status, 'queued')
  if (queued.status !== 'queued') {
    assert.fail('控制状态就绪后应发送同一刷新事务')
  }
  assert.equal(queued.baseRefreshSequence, 4)
  assert.equal(queued.baseSourceGeneration, 7)
  assert.equal(queued.baseConfirmedPath, '/srv/ready')
  assert.equal(calls, 1)
})

test('目录刷新 transport 抛出异常时返回失败', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true, () => {
    throw new Error('socket closed')
  })

  assert.deepEqual(runtime.refreshDirectory('ses-1'), { status: 'not_ready' })
})

test('目录刷新复用在途 request id 并忽略其他事务错误', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  let calls = 0
  runtime.registerTransport('ses-1', () => true, () => {
    calls += 1
    return true
  })

  const first = runtime.refreshDirectory('ses-1')
  const second = runtime.refreshDirectory('ses-1')
  assert.equal(first.status, 'queued')
  assert.equal(second.status, 'queued')
  if (first.status !== 'queued' || second.status !== 'queued') {
    assert.fail('目录刷新请求应进入队列')
  }
  assert.equal(second.requestId, first.requestId)
  assert.equal(calls, 1)
  assert.equal(runtime.getActiveRefreshRequestId('ses-1'), first.requestId)

  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: 'refresh-stale',
    code: 'STALE_REFRESH',
    retryable: true,
    message: '过期刷新错误',
  }), false)
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_change',
    request_id: first.requestId,
    code: 'WRONG_SCOPE',
    retryable: false,
    message: '错误作用域',
  }), false)
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: first.requestId,
    code: 'CWD_REFRESH_BUSY',
    retryable: true,
    message: '稍后重试',
  }), true)
  assert.equal(
    runtime.getRequestErrorSnapshot('ses-1', 'cwd_refresh')?.request_id,
    first.requestId,
  )

  const retry = runtime.retryActiveRefreshDirectory('ses-1')
  assert.equal(retry.status, 'queued')
  if (retry.status !== 'queued') {
    assert.fail('可重试错误应沿用原事务重新发送')
  }
  assert.equal(retry.requestId, first.requestId)
  assert.equal(retry.baseRefreshSequence, first.baseRefreshSequence)
  assert.equal(retry.baseSourceGeneration, first.baseSourceGeneration)
  assert.equal(retry.baseConfirmedPath, first.baseConfirmedPath)
  assert.equal(calls, 2)
  assert.equal(runtime.getRequestErrorSnapshot('ses-1', 'cwd_refresh'), null)

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    state_seq: 2,
    refresh_request_id: first.requestId,
    refresh_status: 'failed',
    refresh_error_code: 'PROXY_TIMEOUT',
    refresh_error: '代理连接超时',
  })), true)
  assert.equal(runtime.getActiveRefreshRequestId('ses-1'), '')

  const next = runtime.retryActiveRefreshDirectory('ses-1')
  assert.equal(next.status, 'queued')
  if (next.status !== 'queued') {
    assert.fail('已终态的刷新应创建新事务')
  }
  assert.notEqual(next.requestId, first.requestId)
  assert.equal(calls, 3)
})

test('同路径刷新确认会清理刷新错误和旧目录切换错误', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState({ refresh_seq: 2 }))
  runtime.registerTransport('ses-1', () => true, () => true)

  const change = runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')
  assert.equal(change.status, 'queued')
  if (change.status !== 'queued') {
    assert.fail('目录切换请求应进入队列')
  }
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_change',
    request_id: change.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  }), true)

  const refresh = runtime.refreshDirectory('ses-1')
  assert.equal(refresh.status, 'queued')
  if (refresh.status !== 'queued') {
    assert.fail('目录刷新请求应进入队列')
  }
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: refresh.requestId,
    code: 'CWD_REFRESH_BUSY',
    retryable: true,
    message: '稍后重试',
  }), true)

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/root',
    state_seq: 2,
    refresh_seq: 3,
  })), true)
  assert.equal(runtime.getRequestErrorSnapshot('ses-1', 'cwd_change'), null)
  assert.equal(runtime.getRequestErrorSnapshot('ses-1', 'cwd_refresh'), null)
})

test('新目录操作和终端确认路径变化会清理历史刷新错误', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true, () => true)

  const firstRefresh = runtime.refreshDirectory('ses-1')
  assert.equal(firstRefresh.status, 'queued')
  if (firstRefresh.status !== 'queued') {
    assert.fail('目录刷新请求应进入队列')
  }
  runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: firstRefresh.requestId,
    code: 'CWD_REFRESH_BUSY',
    retryable: true,
    message: '稍后重试',
  })
  assert.equal(
    runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp').status,
    'queued',
  )
  assert.equal(runtime.getRequestErrorSnapshot('ses-1', 'cwd_refresh'), null)

  const secondRefresh = runtime.refreshDirectory('ses-1')
  assert.equal(secondRefresh.status, 'queued')
  if (secondRefresh.status !== 'queued') {
    assert.fail('目录刷新请求应进入队列')
  }
  runtime.applyRequestError('ses-1', {
    scope: 'cwd_refresh',
    request_id: secondRefresh.requestId,
    code: 'CWD_REFRESH_BUSY',
    retryable: true,
    message: '稍后重试',
  })
  runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/srv',
    state_seq: 2,
  }))
  assert.equal(runtime.getRequestErrorSnapshot('ses-1', 'cwd_refresh'), null)
})

test('刷新确认不会删除刷新之后新发目录操作的错误关联', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true, () => true)

  const refresh = runtime.refreshDirectory('ses-1')
  const change = runtime.requestDirectoryChange('ses-1', 'fil-1', '/srv/new')
  assert.equal(refresh.status, 'queued')
  assert.equal(change.status, 'queued')
  if (change.status !== 'queued') {
    assert.fail('目录切换请求应进入队列')
  }

  runtime.applyServerState('ses-1', cwdState({
    state_seq: 2,
    refresh_seq: 1,
  }))
  assert.equal(runtime.applyRequestError('ses-1', {
    scope: 'cwd_change',
    request_id: change.request.operation_id,
    code: 'CWD_BUSY',
    retryable: true,
    message: '当前 Shell 正忙',
  }), true)
  assert.equal(
    runtime.getRequestErrorSnapshot('ses-1', 'cwd_change')?.request_id,
    change.request.operation_id,
  )
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
