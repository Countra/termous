import assert from 'node:assert/strict'
import test from 'node:test'
import type { ForwardInstance } from '#entities/forward'
import {
  buildForwardRestartRequest,
  forwardRuntimeActionAvailability,
  isForwardRestartCompleted,
  isForwardStartSettledStatus,
  reconcileForwardsAfterRestartFailure,
  restartForwardInstance,
  selectForwardStartSnapshot,
  shouldApplyForwardPollResponse,
} from './forwardRestart.ts'

test('已保存配置按配置标识重启并应用当前配置', () => {
  const forward = createForward({
    profile_id: 'profile-1',
    scope: 'background_profile',
  })

  assert.deepEqual(buildForwardRestartRequest(forward), {
    profile_id: 'profile-1',
    scope: 'background_profile',
  })
})

test('会话和单次后台转发保留原作用域及端点配置', () => {
  const sessionForward = createForward({
    scope: 'session',
    session_id: 'session-1',
    host_id: 'host-1',
    ssh_profile_id: 'ssh-profile-1',
  })
  assert.deepEqual(buildForwardRestartRequest(sessionForward), {
    scope: 'session',
    session_id: 'session-1',
    host_id: 'host-1',
    ssh_profile_id: 'ssh-profile-1',
    name: '测试转发',
    description: '测试说明',
    mode: 'local',
    bind_host: '127.0.0.1',
    bind_port: 8080,
    target_host: 'example.test',
    target_port: 443,
  })

  const dynamicForward = createForward({
    scope: 'background_once',
    mode: 'dynamic',
    target_host: '不应保留',
    target_port: 65535,
  })
  assert.deepEqual(buildForwardRestartRequest(dynamicForward), {
    scope: 'background_once',
    session_id: undefined,
    host_id: 'host-1',
    ssh_profile_id: 'ssh-profile-1',
    name: '测试转发',
    description: '测试说明',
    mode: 'dynamic',
    bind_host: '127.0.0.1',
    bind_port: 8080,
    target_host: '',
    target_port: 0,
  })
})

test('重启严格等待停止成功后才创建替代实例', async () => {
  const calls: string[] = []
  const forward = createForward()
  const replacement = createForward({ id: 'forward-2', started_at: '2026-07-28T11:00:00Z' })

  const result = await restartForwardInstance(
    forward,
    async (id) => {
      calls.push(`stop:${id}`)
    },
    async (input) => {
      calls.push(`start:${input.scope}`)
      return replacement
    },
  )

  assert.equal(result.id, replacement.id)
  assert.deepEqual(calls, ['stop:forward-1', 'start:background_once'])
})

test('停止失败时不会继续启动替代实例', async () => {
  let startCalls = 0
  await assert.rejects(
    restartForwardInstance(
      createForward(),
      async () => {
        throw new Error('停止失败')
      },
      async () => {
        startCalls += 1
        return createForward({ id: 'unexpected' })
      },
    ),
    /停止失败/,
  )
  assert.equal(startCalls, 0)
})

test('启动替代实例失败时向上返回错误', async () => {
  const calls: string[] = []
  await assert.rejects(
    restartForwardInstance(
      createForward(),
      async (id) => {
        calls.push(`stop:${id}`)
      },
      async (input) => {
        calls.push(`start:${input.scope}`)
        throw new Error('启动失败')
      },
    ),
    /启动失败/,
  )
  assert.deepEqual(calls, ['stop:forward-1', 'start:background_once'])
})

test('停止结果不确定时采用服务端权威列表', () => {
  const unrelated = createForward({ id: 'forward-unrelated', bytes_out: 20 })
  const current = [createForward(), unrelated]

  const reconciled = reconcileForwardsAfterRestartFailure(
    current,
    [createForward({ status: 'running', bytes_out: 10 })],
    'forward-1',
    false,
  )
  assert.equal(reconciled.find((forward) => forward.id === 'forward-1')?.bytes_out, 10)
  assert.equal(reconciled.find((forward) => forward.id === unrelated.id), unrelated)
  assert.deepEqual(
    reconcileForwardsAfterRestartFailure(current, [], 'forward-1', false),
    [unrelated],
  )
})

test('停止结果无法对账时只移除已经确认停止的实例', () => {
  const unrelated = createForward({
    id: 'forward-unrelated',
    bytes_out: 30,
  })
  const current = [createForward(), unrelated]

  assert.equal(
    reconcileForwardsAfterRestartFailure(current, null, 'forward-1', false),
    current,
  )
  const reconciled = reconcileForwardsAfterRestartFailure(
    current,
    [createForward({ id: 'forward-unrelated', bytes_out: 10 })],
    'forward-1',
    true,
  )
  assert.deepEqual(reconciled, [unrelated])
  assert.equal(reconciled[0], unrelated)
})

test('启动响应与事件竞态时采用最新事件快照', () => {
  const startResponse = createForward({ status: 'starting' })
  const runningEvent = createForward({
    status: 'running',
    phase: 'ready',
    progress: 100,
  })

  assert.equal(selectForwardStartSnapshot(startResponse, null), startResponse)
  assert.equal(
    selectForwardStartSnapshot(startResponse, runningEvent),
    runningEvent,
  )
})

test('等待主机信任和停止过程不是启动终态', () => {
  assert.equal(isForwardStartSettledStatus('starting'), false)
  assert.equal(isForwardStartSettledStatus('waiting_host_trust'), false)
  assert.equal(isForwardStartSettledStatus('reconnecting'), false)
  assert.equal(isForwardStartSettledStatus('stopping'), false)
  assert.equal(isForwardStartSettledStatus('running'), true)
  assert.equal(isForwardStartSettledStatus('stopped'), true)
  assert.equal(isForwardStartSettledStatus('failed'), true)
})

test('只有真正运行的替代实例触发重启完成提示', () => {
  assert.equal(isForwardRestartCompleted(createForward({ status: 'running' })), true)
  assert.equal(isForwardRestartCompleted(createForward({ status: 'starting' })), false)
  assert.equal(isForwardRestartCompleted(createForward({ status: 'waiting_host_trust' })), false)
  assert.equal(isForwardRestartCompleted(createForward({ status: 'failed' })), false)
  assert.equal(isForwardRestartCompleted(null), false)
})

test('轮询响应只在请求期间没有新事件时允许提交', () => {
  assert.equal(shouldApplyForwardPollResponse(3, 3), true)
  assert.equal(shouldApplyForwardPollResponse(3, 4), false)
})

test('运行实例允许重启和停止，过渡状态只允许停止或全部禁用', () => {
  assert.deepEqual(forwardRuntimeActionAvailability('running'), {
    restart: true,
    stop: true,
  })
  assert.deepEqual(forwardRuntimeActionAvailability('starting'), {
    restart: false,
    stop: true,
  })
  assert.deepEqual(forwardRuntimeActionAvailability('waiting_host_trust'), {
    restart: false,
    stop: true,
  })
  assert.deepEqual(forwardRuntimeActionAvailability('reconnecting'), {
    restart: false,
    stop: true,
  })
  assert.deepEqual(forwardRuntimeActionAvailability('stopping'), {
    restart: false,
    stop: false,
  })
})

function createForward(patch: Partial<ForwardInstance> = {}): ForwardInstance {
  return {
    id: 'forward-1',
    host_id: 'host-1',
    ssh_profile_id: 'ssh-profile-1',
    name: '测试转发',
    description: '测试说明',
    mode: 'local',
    scope: 'background_once',
    status: 'running',
    phase: 'ready',
    progress: 100,
    bind_host: '127.0.0.1',
    bind_port: 8080,
    target_host: 'example.test',
    target_port: 443,
    active_connections: 0,
    total_connections: 0,
    bytes_in: 0,
    bytes_out: 0,
    started_at: '2026-07-28T10:00:00Z',
    ...patch,
  }
}
