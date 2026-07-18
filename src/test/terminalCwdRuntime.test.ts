import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionCwdState } from '../types/domain.ts'
import {
  normalizePosixPath,
  parseOSC7Payload,
  parsePrivateCwdPayload,
  TerminalCwdRuntime,
} from '../features/terminal/terminalCwdRuntime.ts'

function cwdState(overrides: Partial<SessionCwdState> = {}): SessionCwdState {
  return {
    confirmed_path: '/root',
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

test('服务端 CWD 状态按 source generation 和 revision 单调合并', () => {
  const runtime = new TerminalCwdRuntime()

  assert.equal(runtime.applyServerState('ses-1', cwdState()), true)
  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/stale',
    revision: 0,
  })), false)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/root')

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/new-source',
    revision: 0,
    prompt_generation: 0,
    source_generation: 8,
  })), true)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/new-source')
})

test('同一 revision 的旧 prompt generation 不会覆盖新状态', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState({ prompt_generation: 4 }))

  assert.equal(runtime.applyServerState('ses-1', cwdState({
    confirmed_path: '/stale',
    prompt_generation: 3,
  })), false)
  assert.equal(runtime.getSnapshot('ses-1').confirmed_path, '/root')
})

test('目录请求 latest-wins 且使用递增 revision', () => {
  const runtime = new TerminalCwdRuntime()
  const requests: Array<{ path: string; revision: number }> = []
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', (request) => {
    requests.push({ path: request.path, revision: request.revision })
    return true
  })

  const first = runtime.requestDirectoryChange('ses-1', 'fil-1', '/root/first')
  const second = runtime.requestDirectoryChange('ses-1', 'fil-1', '/root/second')

  assert.equal(first.status, 'queued')
  assert.equal(second.status, 'queued')
  assert.deepEqual(requests, [
    { path: '/root/first', revision: 2 },
    { path: '/root/second', revision: 3 },
  ])
  assert.equal(runtime.getSnapshot('ses-1').desired_path, '/root/second')
  assert.equal(runtime.getSnapshot('ses-1').pending_operation?.revision, 3)
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

test('cwd_error 只失败当前 pending operation 并保留 last-good path', () => {
  const runtime = new TerminalCwdRuntime()
  runtime.applyServerState('ses-1', cwdState())
  runtime.registerTransport('ses-1', () => true)
  runtime.requestDirectoryChange('ses-1', 'fil-1', '/tmp')

  assert.equal(runtime.applyRequestError('ses-1', '当前 Shell 正忙'), true)
  const state = runtime.getSnapshot('ses-1')
  assert.equal(state.confirmed_path, '/root')
  assert.equal(state.desired_path, undefined)
  assert.equal(state.pending_operation?.status, 'failed')
  assert.equal(state.pending_operation?.error, '当前 Shell 正忙')
})

test('过期 cwd_error 不会覆盖较新的 pending operation', () => {
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
    runtime.applyRequestError('ses-1', '过期错误', first.request.operation_id),
    false,
  )
  assert.equal(
    runtime.getSnapshot('ses-1').pending_operation?.id,
    second.request.operation_id,
  )
  assert.equal(runtime.getSnapshot('ses-1').pending_operation?.status, 'queued')
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

test('OSC 7 只接受无凭据、无查询且为绝对路径的 file URI', () => {
  assert.deepEqual(parseOSC7Payload('file://server/root/a%20b'), {
    authority: 'server',
    path: '/root/a b',
  })
  assert.equal(parseOSC7Payload('https://server/root'), null)
  assert.equal(parseOSC7Payload('file://user@server/root'), null)
  assert.equal(parseOSC7Payload('file://server/root?query=1'), null)
  assert.equal(parseOSC7Payload('file:///root'), null)
})

test('私有 OSC 仅接受版本化 phase 与 cwd ack', () => {
  assert.deepEqual(
    parsePrivateCwdPayload('termous;1;phase;nonce_1;7;3;prompt'),
    {
      kind: 'phase',
      nonce: 'nonce_1',
      sourceGeneration: 7,
      promptGeneration: 3,
      phase: 'prompt',
    },
  )
  assert.deepEqual(
    parsePrivateCwdPayload('termous;1;cwd;nonce_1;7;3;9;cwd-op_1;ok;prompt'),
    {
      kind: 'ack',
      nonce: 'nonce_1',
      sourceGeneration: 7,
      promptGeneration: 3,
      revision: 9,
      operationId: 'cwd-op_1',
      status: 'ok',
      phase: 'prompt',
    },
  )
  assert.equal(parsePrivateCwdPayload('termous;2;phase;nonce_1;7;3;prompt'), null)
  assert.equal(parsePrivateCwdPayload('termous;1;cwd;bad nonce;7;3;9;op;ok;prompt'), null)
})

test('POSIX 路径规范化拒绝相对路径和控制字符', () => {
  assert.equal(normalizePosixPath('/root/./a/../b'), '/root/b')
  assert.equal(normalizePosixPath('/'), '/')
  assert.equal(normalizePosixPath('root'), null)
  assert.equal(normalizePosixPath('/root\u0000bad'), null)
  assert.equal(normalizePosixPath('/root/\ud800bad'), null)
  assert.equal(normalizePosixPath('/root/\udc00bad'), null)
  assert.equal(normalizePosixPath('/root/😀'), '/root/😀')
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
