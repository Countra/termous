import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentMcpPolicy,
  AgentMessagePage,
  AgentQueueState,
  AgentQueuedTurn,
  AgentQueuedTurnPage,
  AgentRun,
  AgentRunEventPage,
  AgentSession,
  AgentSessionContext,
  AgentSessionPage,
  AgentSessionUsage,
} from '#entities/agent'
import type { AgentRuntimeCommandResult, AgentRuntimeStatus } from '#common/contracts'
import type {
  AgentMessageListOptions,
  AgentCreateRunInput,
  AgentRunEventListOptions,
  AgentSessionListOptions,
  AgentWorkspaceGateway,
} from '../api/agentRuntimeGateway.ts'
import {
  agentDeltaEventFixture,
  agentFixtureTime,
  agentMessageFixture,
  agentRunFixture,
  agentSessionFixture,
  agentStatusEventFixture,
} from '../model/agentRuntimeTestFixtures.ts'
import {
  AgentRuntimeStartError,
  AgentWorkspaceController,
  AgentWorkspaceControllerError,
} from './AgentWorkspaceController.ts'

test('Run 持久化后清空对应草稿，Runtime 启动拒绝不恢复已提交内容', async () => {
  const rejectedGateway = new FakeGateway()
  rejectedGateway.startResult = commandResult(false, 'AGENT_RUNTIME_START_REJECTED')
  rejectedGateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'cancelled', revision: expectedRevision + 1 })
  )
  const rejected = new AgentWorkspaceController({ gateway: rejectedGateway })
  const session = await rejected.createSession(sessionInput())
  rejected.updateDraft(session.id, '保留的请求')

  await assert.rejects(
    rejected.startRun(session.id, '保留的请求'),
    (error: unknown) => error instanceof AgentRuntimeStartError
      && error.code === 'AGENT_RUNTIME_START_REJECTED',
  )
  assert.equal(rejected.getSnapshot().drafts[session.id], undefined)
  assert.equal(rejected.getSnapshot().runs['agr-run']?.status, 'cancelled')
  assert.deepEqual(rejectedGateway.stopRequests, [{
    id: 'agr-run', expectedRevision: 1, expectedGeneration: 1,
  }])
  assert.deepEqual(rejectedGateway.stopped, [])

  const acceptedGateway = new FakeGateway()
  const accepted = new AgentWorkspaceController({ gateway: acceptedGateway })
  const acceptedSession = await accepted.createSession(sessionInput())
  accepted.updateDraft(acceptedSession.id, '正常请求')
  await accepted.startRun(acceptedSession.id, '正常请求')
  assert.equal(accepted.getSnapshot().drafts[acceptedSession.id], undefined)
  assert.deepEqual(acceptedGateway.started, [{ run_id: 'agr-run', generation: 1 }])
})

test('Run 创建失败时保留尚未持久化的草稿', async () => {
  const gateway = new FakeGateway()
  gateway.createRunImpl = async () => {
    throw new AgentWorkspaceControllerError('AGENT_RUN_CREATE_FAILED')
  }
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  controller.updateDraft(session.id, '尚未提交的请求')

  await assert.rejects(
    controller.startRun(session.id, '尚未提交的请求'),
    /AGENT_RUN_CREATE_FAILED/,
  )

  assert.equal(controller.getSnapshot().drafts[session.id]?.text, '尚未提交的请求')
  assert.deepEqual(gateway.started, [])
})

test('新会话草稿持久化后显式选择创建的会话', async () => {
  const controller = new AgentWorkspaceController({ gateway: new FakeGateway() })
  controller.selectSession(undefined)

  const session = await controller.createSession(sessionInput())

  assert.equal(controller.getSnapshot().selected_session_id, session.id)
  assert.equal(controller.getSnapshot().new_session_selected, false)
})

test('已移除会话的迟到选择不会取消当前会话水合或触发无效请求', async () => {
  const gateway = new FakeGateway()
  const controller = startedController(gateway)
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  const messageRequests = gateway.messageSignals.length
  const contextRequests = gateway.contextCalls
  const usageRequests = gateway.usageCalls

  controller.selectSession('ags-removed')

  assert.equal(controller.getSnapshot().selected_session_id, 'ags-session')
  assert.equal(gateway.messageSignals.length, messageRequests)
  assert.equal(gateway.contextCalls, contextRequests)
  assert.equal(gateway.usageCalls, usageRequests)
  controller.close()
})

test('迟到的更新响应不会覆盖 WebSocket 已接收的更高会话 revision', async () => {
  const gateway = new FakeGateway()
  const pending = deferred<AgentSession>()
  gateway.updateSession = async () => await pending.promise
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [],
  })
  const update = controller.updateSession('ags-session', {
    ...sessionInput(), archived: false, expected_revision: 1,
  })
  socket.message({
    type: 'upsert', revision: 1,
    session: agentSessionFixture({ title: '较新的会话', revision: 3 }),
  })
  pending.resolve(agentSessionFixture({ title: '迟到的响应', revision: 2 }))
  await update

  assert.equal(controller.getSnapshot().sessions[0]?.revision, 3)
  assert.equal(controller.getSnapshot().sessions[0]?.title, '较新的会话')
  controller.close()
})

test('资源绑定 revision 冲突恢复可单独刷新权威会话', async () => {
  const gateway = new FakeGateway()
  gateway.sessionImpl = async (id) => {
    assert.equal(id, 'ags-session')
    return agentSessionFixture({ title: '权威会话', revision: 7 })
  }
  const controller = startedController(gateway)
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')

  const refreshed = await controller.reloadSession('ags-session')

  assert.equal(refreshed?.revision, 7)
  assert.equal(controller.getSnapshot().sessions[0]?.title, '权威会话')
  controller.close()
})

test('Runtime Bridge 抛错时取消已持久化的 queued Run', async () => {
  const gateway = new FakeGateway()
  gateway.startResult = Promise.reject(new Error('AGENT_RUNTIME_BRIDGE_UNAVAILABLE'))
  gateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'cancelled', revision: expectedRevision + 1 })
  )
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())

  await assert.rejects(controller.startRun(session.id, '执行任务'), /AGENT_RUNTIME_BRIDGE_UNAVAILABLE/)

  assert.equal(controller.getSnapshot().runs['agr-run']?.status, 'cancelled')
  assert.deepEqual(gateway.stopRequests, [{
    id: 'agr-run', expectedRevision: 1, expectedGeneration: 1,
  }])
})

test('Runtime 启动收尾不会覆盖在途输入的新 steer 草稿', async () => {
  const gateway = new FakeGateway()
  const startResult = deferred<AgentRuntimeCommandResult>()
  gateway.startResult = startResult.promise
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  controller.updateDraft(session.id, '初始请求')

  const starting = controller.startRun(session.id, '初始请求')
  await waitFor(() => gateway.started.length === 1)
  controller.updateDraft(session.id, '运行中追加的要求')
  startResult.resolve(commandResult(true))
  await starting

  assert.equal(controller.getSnapshot().drafts[session.id]?.text, '运行中追加的要求')
})

test('手工整理只随下一次 Run 提交且 Runtime 接管成功后清除', async () => {
  const rejectedGateway = new FakeGateway()
  rejectedGateway.startResult = commandResult(false, 'AGENT_RUNTIME_START_REJECTED')
  rejectedGateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'cancelled', revision: expectedRevision + 1 })
  )
  const rejected = startedController(rejectedGateway)
  await waitFor(() => rejected.getSnapshot().session_contexts['ags-session']?.phase === 'ready')
  rejected.setContextCompressionPending('ags-session', true)

  await assert.rejects(rejected.startRun('ags-session', '整理后回答'))
  assert.equal(rejectedGateway.createRunRequests[0]?.force_context_compression, true)
  assert.equal(rejected.getSnapshot().session_contexts['ags-session']?.compression_pending, true)
  rejected.close()

  const acceptedGateway = new FakeGateway()
  const accepted = startedController(acceptedGateway)
  await waitFor(() => accepted.getSnapshot().session_contexts['ags-session']?.phase === 'ready')
  accepted.setContextCompressionPending('ags-session', true)
  await accepted.startRun('ags-session', '整理后回答')

  assert.equal(acceptedGateway.createRunRequests[0]?.force_context_compression, true)
  assert.equal(accepted.getSnapshot().session_contexts['ags-session']?.compression_pending, false)
  accepted.close()
})

test('上下文读取失败只降级检查器并支持独立重试', async () => {
  const gateway = new FakeGateway()
  gateway.contextImpl = async () => {
    throw Object.assign(new Error('temporary'), { code: 'NETWORK_ERROR' })
  }
  const controller = startedController(gateway)
  await waitFor(() => controller.getSnapshot().session_contexts['ags-session']?.phase === 'error')

  assert.notEqual(controller.getSnapshot().phase, 'degraded')
  assert.equal(controller.getSnapshot().session_contexts['ags-session']?.error_code, 'NETWORK_ERROR')

  gateway.contextImpl = async () => contextFixture()
  await controller.reloadContext('ags-session')
  assert.equal(controller.getSnapshot().session_contexts['ags-session']?.value?.estimated_tokens, 24_000)
  controller.close()
})

test('Token 统计独立失败并在手工重试时保留旧快照', async () => {
  const gateway = new FakeGateway()
  const controller = startedController(gateway)
  await waitFor(() => controller.getSnapshot().session_usages['ags-session']?.phase === 'ready')
  const previous = controller.getSnapshot().session_usages['ags-session']?.value
  gateway.usageImpl = async () => {
    throw Object.assign(new Error('temporary'), { code: 'NETWORK_ERROR' })
  }

  await controller.reloadUsage('ags-session')

  const usage = controller.getSnapshot().session_usages['ags-session']
  assert.equal(usage?.phase, 'error')
  assert.equal(usage?.value, previous)
  assert.equal(usage?.error_code, 'NETWORK_ERROR')
  assert.notEqual(controller.getSnapshot().phase, 'degraded')
  controller.close()
})

test('缺少 Preload Runtime Bridge 时工作区仍可加载', async () => {
  const gateway = new FakeGateway()
  gateway.runtimeStatus = () => { throw new Error('AGENT_RUNTIME_BRIDGE_UNAVAILABLE') }
  gateway.onRuntimeStatus = () => { throw new Error('AGENT_RUNTIME_BRIDGE_UNAVAILABLE') }
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
  })

  assert.doesNotThrow(() => controller.start())
  await settle()

  assert.notEqual(controller.getSnapshot().phase, 'degraded')
  controller.close()
})

test('WebSocket 只有接收权威快照后才完成对账', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })

  controller.start()
  socket.open()
  await settle()
  assert.equal(controller.getSnapshot().phase, 'loading')
  assert.equal(controller.getSnapshot().snapshot_complete, false)

  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [],
  })
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.equal(controller.getSnapshot().snapshot_complete, true)
  assert.equal(controller.getSnapshot().error_code, undefined)
  controller.close()
})

test('连续文本 delta 只在刷新窗口或后续权威事件到达时通知视图', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const timers: Array<{ id: number; callback: () => void; delay: number }> = []
  const cleared: number[] = []
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    setTimer: (callback, delay) => {
      const id = timers.length + 1
      timers.push({ id, callback, delay })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (timer) => cleared.push(timer as unknown as number),
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().messages['ags-session']?.length === 1)
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  let notifications = 0
  const unsubscribe = controller.subscribe(() => { notifications += 1 })
  const first = agentDeltaEventFixture()
  socket.message({ type: 'upsert', revision: 1, run_event: first })
  socket.message({
    type: 'upsert', revision: 2,
    run_event: {
      ...first,
      id: 'age-delta-2',
      sequence: 2,
      payload: { message_delta: { ...first.payload.message_delta, delta: '好' } },
    },
  })

  assert.equal(notifications, 0)
  const part = controller.getSnapshot().messages['ags-session']?.[0]?.parts[0]
  assert.equal(
    part?.kind === 'text' ? part.text : '',
    '你好',
  )
  const streamTimer = timers.find(({ delay }) => delay === 64)
  assert.ok(streamTimer)

  socket.message({
    type: 'upsert', revision: 3,
    run: agentRunFixture({ event_sequence: 2, revision: 2 }),
  })
  assert.equal(notifications, 0)
  assert.ok(!cleared.includes(streamTimer.id))

  streamTimer.callback()
  assert.equal(notifications, 1)

  const third = {
    ...first,
    id: 'age-delta-3',
    sequence: 3,
    payload: { message_delta: { ...first.payload.message_delta, delta: '！' } },
  }
  socket.message({ type: 'upsert', revision: 4, run_event: third })
  const nextStreamTimer = timers.find(({ id }) => id !== streamTimer.id && !cleared.includes(id))
  assert.ok(nextStreamTimer)
  const notificationsBeforeTerminal = notifications
  socket.message({
    type: 'upsert', revision: 5,
    run: agentRunFixture({ event_sequence: 3, status: 'completed', revision: 3 }),
  })
  assert.ok(notifications > notificationsBeforeTerminal)
  assert.ok(cleared.includes(nextStreamTimer.id))
  unsubscribe()
  controller.close()
})

test('默认流式定时器清理不会把控制器作为原生 clearTimeout 接收者', async () => {
  const originalClearTimeout = globalThis.clearTimeout
  const receivers: unknown[] = []
  globalThis.clearTimeout = function (this: unknown) {
    receivers.push(this)
  } as typeof clearTimeout
  let controller: AgentWorkspaceController | undefined
  try {
    const gateway = new FakeGateway()
    const socket = new FakeSocket()
    controller = new AgentWorkspaceController({
      gateway,
      socketFactory: () => socket as unknown as WebSocket,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    })
    controller.start()
    await waitFor(() => controller?.getSnapshot().messages['ags-session']?.length === 1)
    socket.open()
    socket.message({
      type: 'snapshot', revision: 0,
      sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    })
    const delta = agentDeltaEventFixture()
    socket.message({ type: 'upsert', revision: 1, run_event: delta })
    socket.message({
      type: 'upsert', revision: 2,
      run: agentRunFixture({ event_sequence: delta.sequence, status: 'completed', revision: 2 }),
    })

    assert.ok(receivers.length > 0)
    assert.ok(receivers.every((receiver) => receiver !== controller))
  } finally {
    controller?.close()
    globalThis.clearTimeout = originalClearTimeout
  }
})

test('权威快照后的成功重试会清除工作区降级状态', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })

  controller.start()
  socket.open()
  await settle()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  gateway.runImpl = async () => {
    throw Object.assign(new Error('temporary'), { code: 'NETWORK_ERROR' })
  }
  socket.message({
    type: 'upsert', revision: 1,
    run_event: agentStatusEventFixture({ sequence: 2 }),
  })
  await waitFor(() => controller.getSnapshot().phase === 'degraded')
  assert.equal(controller.getSnapshot().snapshot_complete, true)

  gateway.runImpl = async () => agentRunFixture()
  await controller.reload()
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.equal(controller.getSnapshot().error_code, undefined)
  controller.close()
})

test('重试期间收到新增量时不会用已失效水合误清除降级状态', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })

  controller.start()
  socket.open()
  await settle()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  gateway.runImpl = async () => {
    throw Object.assign(new Error('temporary'), { code: 'NETWORK_ERROR' })
  }
  socket.message({
    type: 'upsert', revision: 1,
    run_event: agentStatusEventFixture({ sequence: 2 }),
  })
  await waitFor(() => controller.getSnapshot().phase === 'degraded')

  const pendingRun = deferred<AgentRun>()
  let pendingRunRequested = false
  gateway.runImpl = async () => {
    pendingRunRequested = true
    return pendingRun.promise
  }
  const reload = controller.reload()
  await waitFor(() => pendingRunRequested)
  socket.message({
    type: 'upsert', revision: 2,
    session: agentSessionFixture({ revision: 2 }),
  })
  pendingRun.resolve(agentRunFixture())
  await reload

  assert.equal(controller.getSnapshot().phase, 'degraded')
  assert.equal(controller.getSnapshot().error_code, 'NETWORK_ERROR')
  controller.close()
})

test('steer 与 stop 使用当前 Run 的 ID、generation 和 revision', async () => {
  const gateway = new FakeGateway()
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  await controller.steerActiveRun('补充约束')
  await controller.stopActiveRun()

  assert.deepEqual(gateway.steered, [{ run_id: 'agr-run', generation: 1, message: '补充约束' }])
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
  assert.deepEqual(gateway.stopRequests, [{
    id: 'agr-run', expectedRevision: 1, expectedGeneration: 1,
  }])
})

test('停止期间 Core 已先进入终态时仍收口已发出的 Worker 取消请求', async () => {
  const gateway = new FakeGateway()
  gateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'cancelled', revision: expectedRevision + 1 })
  )
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const stopped = await controller.stopActiveRun()

  assert.equal(stopped?.status, 'cancelled')
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
})

test('停止请求不等待 Core 写入即可先向 Worker 发送取消', async () => {
  const gateway = new FakeGateway()
  const pending = deferred<AgentRun>()
  gateway.stopRunImpl = async () => pending.promise
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const operation = controller.stopActiveRun()
  await waitFor(() => gateway.stopRequests.length === 1)

  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
  pending.resolve(agentRunFixture({ status: 'stopping', revision: 2 }))
  await operation
})

test('停止过程中 Worker 已退出时以 Core 状态继续对账', async () => {
  const gateway = new FakeGateway()
  gateway.stopResult = commandResult(false, 'AGENT_RUNTIME_RUN_NOT_ACTIVE')
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const stopped = await controller.stopActiveRun()

  assert.equal(stopped?.status, 'stopping')
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
})

test('停止落库后后继 Worker 已启动时不把旧 Run 冲突误报为失败', async () => {
  const gateway = new FakeGateway()
  gateway.stopResult = commandResult(false, 'AGENT_RUNTIME_RUN_CONFLICT')
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const stopped = await controller.stopActiveRun()

  assert.equal(stopped?.status, 'stopping')
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
  await waitFor(() => gateway.runCalls === 1)
})

test('队列写入在途时停止任务使用独立控制通道', async () => {
  const gateway = new FakeGateway()
  const pendingTurn = deferred<AgentQueuedTurn>()
  gateway.enqueueTurnImpl = async () => pendingTurn.promise
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const enqueue = controller.enqueueTurn(session.id, '追加检查')
  await waitFor(() => gateway.enqueueTurnRequests.length === 1)
  const stopped = await controller.stopActiveRun()

  assert.equal(stopped?.status, 'stopping')
  assert.deepEqual(gateway.stopRequests, [{
    id: 'agr-run', expectedRevision: 1, expectedGeneration: 1,
  }])
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
  pendingTurn.resolve(queuedTurnFixture({ prompt: '追加检查' }))
  await enqueue
})

test('Run 在提交边界进入终态时仍将追加消息交给 Core 判定', async () => {
  const gateway = new FakeGateway()
  gateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'completed', revision: expectedRevision + 1, completed_at: agentFixtureTime })
  )
  gateway.enqueueTurnImpl = async (_sessionId, input) => queuedTurnFixture({
    client_request_id: input.client_request_id,
    prompt: input.prompt,
  })
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')
  await controller.stopActiveRun()

  const queued = await controller.enqueueTurn(session.id, '紧接着执行下一步')

  assert.equal(queued.prompt, '紧接着执行下一步')
  assert.deepEqual(gateway.enqueueTurnRequests.map(({ sessionId, input }) => ({
    sessionId,
    prompt: input.prompt,
  })), [{
    sessionId: session.id,
    prompt: '紧接着执行下一步',
  }])
})

test('Run 水合期间收到 WS 增量会丢弃旧响应并自动重跑', async () => {
  const gateway = new FakeGateway()
  const firstRun = deferred<AgentRun>()
  gateway.runImpl = async (_id, signal) => {
    gateway.runSignals.push(signal)
    gateway.runCalls += 1
    if (gateway.runCalls === 1) return firstRun.promise
    return agentRunFixture({ event_sequence: 1, revision: 2 })
  }
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await settle()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture({ event_sequence: 1 })],
  })
  assert.equal(gateway.runCalls, 1)

  socket.message({
    type: 'upsert', revision: 1,
    run_event: agentStatusEventFixture(),
  })
  firstRun.resolve(agentRunFixture({ event_sequence: 1 }))
  await waitFor(() => gateway.runCalls === 2)

  assert.equal(controller.getSnapshot().run_event_sequences['agr-run'], 1)
  assert.equal(gateway.runEventRequests[0]?.afterSequence, 1)
  controller.close()
})

test('close 会中止在途 Session、Message 和 Run 水合', async () => {
  const sessionGateway = new FakeGateway()
  const pendingSessions = deferred<AgentSessionPage>()
  sessionGateway.sessionsImpl = (options) => abortable(pendingSessions, options.signal)
  const sessionController = new AgentWorkspaceController({
    gateway: sessionGateway,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
  })
  sessionController.start()
  await waitFor(() => sessionGateway.sessionSignals.length === 1)
  sessionController.close()
  assert.equal(sessionGateway.sessionSignals[0]?.aborted, true)

  const gateway = new FakeGateway()
  const messages = deferred<AgentMessagePage>()
  const context = deferred<AgentSessionContext>()
  const usage = deferred<AgentSessionUsage>()
  const run = deferred<AgentRun>()
  gateway.messagesImpl = (sessionId, options) => {
    assert.equal(sessionId, 'ags-session')
    return abortable(messages, options.signal)
  }
  gateway.runImpl = (runId, signal) => {
    assert.equal(runId, 'agr-run')
    gateway.runSignals.push(signal)
    return abortable(run, signal)
  }
  gateway.contextImpl = (_sessionId, signal) => abortable(context, signal)
  gateway.usageImpl = (_sessionId, signal) => abortable(usage, signal)
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => (
    gateway.messageSignals.length === 1
    && gateway.contextSignals.length === 1
    && gateway.usageSignals.length === 1
  ))
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture({ event_sequence: 1 })],
  })
  await waitFor(() => gateway.runSignals.length === 1)

  controller.close()
  assert.equal(gateway.messageSignals[0]?.aborted, true)
  assert.equal(gateway.contextSignals[0]?.aborted, true)
  assert.equal(gateway.usageSignals[0]?.aborted, true)
  assert.equal(gateway.runSignals[0]?.aborted, true)
  assert.equal(controller.getSnapshot().phase, 'idle')
  await settle()
})

test('切换会话和权威失效会取消在途 Token 统计请求', async () => {
  for (const invalidate of ['selection', 'revision_gap'] as const) {
    const gateway = new FakeGateway()
    const pending = deferred<AgentSessionUsage>()
    gateway.usageImpl = (_sessionId, signal) => abortable(pending, signal)
    const socket = new FakeSocket()
    const controller = new AgentWorkspaceController({
      gateway,
      socketFactory: () => socket as unknown as WebSocket,
    })
    controller.start()
    await waitFor(() => gateway.usageSignals.length === 1)

    if (invalidate === 'selection') {
      controller.selectSession(undefined)
    } else {
      socket.open()
      socket.message({ type: 'snapshot', revision: 1, sessions: [agentSessionFixture()], active_runs: [] })
      socket.message({ type: 'upsert', revision: 3, session: agentSessionFixture({ revision: 2 }) })
    }

    assert.equal(gateway.usageSignals[0]?.aborted, true, invalidate)
    controller.close()
  }
})

test('revision 缺口关闭当前 WS，等待新连接权威快照', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const timers: Array<() => void> = []
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    setTimer: (callback) => {
      timers.push(callback)
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: () => undefined,
  })
  controller.start()
  await settle()
  socket.message({ type: 'snapshot', revision: 1, sessions: [], active_runs: [] })
  socket.message({
    type: 'upsert', revision: 3, session: agentSessionFixture(),
  })

  assert.equal(socket.closed, true)
  assert.equal(controller.getSnapshot().phase, 'reconnecting')
  assert.equal(controller.getSnapshot().error_code, 'AGENT_WORKSPACE_REVISION_GAP')
  assert.equal(timers.length, 1)
  controller.close()
})

test('正常 Run upsert 不触发 REST 水合，只有 snapshot 水位需要补偿', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await settle()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  socket.message({
    type: 'upsert', revision: 1,
    run: agentRunFixture({ event_sequence: 8, revision: 2 }),
  })
  await settle()

  assert.equal(gateway.runCalls, 0)
  controller.close()
})

test('活动 Run 进入终态后刷新权威上下文容量', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({ gateway, socketFactory: () => socket as unknown as WebSocket })
  controller.start()
  await waitFor(() => gateway.contextCalls === 1)
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  socket.message({
    type: 'upsert', revision: 1,
    run: agentRunFixture({ status: 'completed', revision: 2, completed_at: agentFixtureTime }),
  })
  socket.message({
    type: 'upsert', revision: 2,
    run: agentRunFixture({ status: 'completed', revision: 3, completed_at: agentFixtureTime }),
  })

  await waitFor(() => gateway.contextCalls === 2)
  await settle()
  assert.equal(gateway.contextCalls, 2)
  controller.close()
})

test('连续 usage 事件和 Run 终态合并为一次低频 Token 统计刷新', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const timers: Array<{ callback: () => void; delay: number }> = []
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay })
      return timers.length as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: () => undefined,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().session_usages['ags-session']?.phase === 'ready')
  socket.open()
  await settle()
  const initialUsageCalls = gateway.usageCalls
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  socket.message({
    type: 'upsert', revision: 1,
    run_event: usageEventResponse(1, 10, 4),
  })
  socket.message({
    type: 'upsert', revision: 2,
    run_event: usageEventResponse(2, 20, 8, 6, 2),
  })
  socket.message({
    type: 'upsert', revision: 3,
    run: agentRunFixture({ status: 'completed', revision: 2, completed_at: agentFixtureTime }),
  })

  const usageTimers = timers.filter(({ delay }) => delay === 750)
  assert.equal(usageTimers.length, 1)
  usageTimers[0]!.callback()
  await waitFor(() => gateway.usageCalls === initialUsageCalls + 1)
  controller.close()
})

test('手工刷新 Token 统计会清除同会话尚未执行的合并定时器', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const timers: Array<{ callback: () => void; delay: number; id: number }> = []
  const cleared: number[] = []
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    setTimer: (callback, delay) => {
      const id = timers.length + 1
      timers.push({ callback, delay, id })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (timer) => cleared.push(timer as unknown as number),
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().session_usages['ags-session']?.phase === 'ready')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
  })
  socket.message({
    type: 'upsert', revision: 1,
    run_event: usageEventResponse(1, 10, 4),
  })
  const timer = timers.find(({ delay }) => delay === 750)
  assert.ok(timer)

  await controller.reloadUsage('ags-session')

  assert.deepEqual(cleared, [timer.id])
  controller.close()
})

test('切换会话模型后重新读取对应上下文窗口', async () => {
  const gateway = new FakeGateway()
  const controller = startedController(gateway)
  await waitFor(() => controller.getSnapshot().session_contexts['ags-session']?.phase === 'ready')
  gateway.contextImpl = async () => contextFixture({ context_window_tokens: 65_536 })

  await controller.updateSession('ags-session', {
    ...sessionInput(),
    model_id: 'apm-larger-model',
    archived: false,
    expected_revision: 1,
  })
  await waitFor(() => (
    controller.getSnapshot().session_contexts['ags-session']?.value?.context_window_tokens === 65_536
  ))

  assert.equal(gateway.contextCalls, 2)
  controller.close()
})

test('消息分页拒绝跨页重复的本轮 Run 用量', async () => {
  const gateway = new FakeGateway()
  const turnUsage = {
    run_id: 'agr-duplicate-usage',
    usage: {
      input_tokens: 8,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      output_tokens: 3,
      reasoning_tokens: 1,
      total_tokens: 14,
      estimated: false,
    },
  }
  gateway.messagesImpl = async (_sessionId, options) => options.afterSequence === 0
    ? {
        items: [agentMessageFixture({
          id: 'agm-first', status: 'completed', sequence: 1, turn_usage: turnUsage,
        })],
        next_after_sequence: 1,
      }
    : {
        items: [agentMessageFixture({
          id: 'agm-second', status: 'completed', sequence: 2, turn_usage: turnUsage,
        })],
      }
  const controller = startedController(gateway)

  await waitFor(() => controller.getSnapshot().error_code === 'AGENT_MESSAGE_TURN_USAGE_DUPLICATE')

  assert.equal(controller.getSnapshot().phase, 'degraded')
  controller.close()
})

test('WebSocket 外部变更会话模型后重启已加载的上下文水合', async () => {
  for (const eventType of ['snapshot', 'upsert'] as const) {
    const gateway = new FakeGateway()
    const socket = new FakeSocket()
    const controller = new AgentWorkspaceController({
      gateway,
      socketFactory: () => socket as unknown as WebSocket,
    })
    controller.start()
    await waitFor(() => controller.getSnapshot().session_contexts['ags-session']?.phase === 'ready')
    socket.message({
      type: 'snapshot', revision: 0,
      sessions: [agentSessionFixture()], active_runs: [],
    })
    gateway.contextImpl = async () => contextFixture({ context_window_tokens: 65_536 })

    socket.message(eventType === 'snapshot'
      ? {
          type: 'snapshot', revision: 1,
          sessions: [agentSessionFixture({
            model_id: 'apm-external-model',
            revision: 2,
          })],
          active_runs: [],
        }
      : {
          type: 'upsert', revision: 1,
          session: agentSessionFixture({
            model_id: 'apm-external-model',
            revision: 2,
          }),
        })

    await waitFor(() => (
      controller.getSnapshot().session_contexts['ags-session']?.value?.context_window_tokens === 65_536
    ))
    assert.equal(gateway.contextCalls, 2, eventType)
    controller.close()
  }
})

test('排队响应晚于 WebSocket 派发事件时不会重新插入幽灵消息', async () => {
  const gateway = new FakeGateway()
  const pending = deferred<AgentQueuedTurn>()
  gateway.enqueueTurnImpl = async () => pending.promise
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().active_run_id === 'agr-run')

  const operation = controller.enqueueTurn('ags-session', '下一步检查')
  await waitFor(() => gateway.enqueueTurnRequests.length === 1)
  const turn = queuedTurnFixture({
    client_request_id: gateway.enqueueTurnRequests[0]!.input.client_request_id,
  })
  socket.message({ type: 'upsert', revision: 1, queued_turn: turn })
  socket.message({
    type: 'removed', revision: 2, entity: 'queued_turn',
    id: turn.id, session_id: turn.session_id,
  })
  const hydrationCalls = gateway.queuedTurnCalls
  pending.resolve(turn)
  await operation

  await waitFor(() => gateway.queuedTurnCalls > hydrationCalls)
  assert.deepEqual(controller.getSnapshot().queued_turns['ags-session'] ?? [], [])
  controller.close()
})

test('入队传输失败后使用同一 client_request_id 重试', async () => {
  const gateway = new FakeGateway()
  let attempts = 0
  gateway.enqueueTurnImpl = async (_sessionId, input) => {
    attempts += 1
    if (attempts === 1) throw new Error('NETWORK_ERROR')
    return queuedTurnFixture({ client_request_id: input.client_request_id })
  }
  const socket = new FakeSocket()
  let requestSequence = 0
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    newClientRequestID: () => `request-retry-${++requestSequence}`,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().active_run_id === 'agr-run')

  await assert.rejects(controller.enqueueTurn('ags-session', '保持幂等', ['aga-one']))
  await controller.enqueueTurn('ags-session', '保持幂等', ['aga-one'])

  assert.equal(gateway.enqueueTurnRequests.length, 2)
  assert.equal(
    gateway.enqueueTurnRequests[0]!.input.client_request_id,
    gateway.enqueueTurnRequests[1]!.input.client_request_id,
  )
  assert.equal(requestSequence, 1)
  controller.close()
})

test('入队回执丢失时自动使用同一 client_request_id 幂等确认', async () => {
  const gateway = new FakeGateway()
  let attempts = 0
  gateway.enqueueTurnImpl = async (_sessionId, input) => {
    attempts += 1
    if (attempts === 1) {
      throw Object.assign(new Error('response lost'), { code: 'NETWORK_ERROR' })
    }
    return queuedTurnFixture({ client_request_id: input.client_request_id })
  }
  const socket = new FakeSocket()
  let requestSequence = 0
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
    newClientRequestID: () => `request-recover-${++requestSequence}`,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().active_run_id === 'agr-run')

  await controller.enqueueTurn('ags-session', '确认已提交的消息')

  assert.equal(gateway.enqueueTurnRequests.length, 2)
  assert.equal(
    gateway.enqueueTurnRequests[0]!.input.client_request_id,
    gateway.enqueueTurnRequests[1]!.input.client_request_id,
  )
  assert.equal(requestSequence, 1)
  assert.equal(controller.getSnapshot().queued_turns['ags-session']?.length, 1)
  controller.close()
})

test('手工整理请求只绑定第一条成功持久化的排队消息', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().session_contexts['ags-session']?.phase === 'ready')
  controller.setContextCompressionPending('ags-session', true)
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().active_run_id === 'agr-run')

  await controller.enqueueTurn('ags-session', '先整理上下文')
  await controller.enqueueTurn('ags-session', '继续处理')

  assert.equal(gateway.enqueueTurnRequests[0]?.input.force_context_compression, true)
  assert.equal(gateway.enqueueTurnRequests[1]?.input.force_context_compression, false)
  assert.equal(controller.getSnapshot().session_contexts['ags-session']?.compression_pending, false)
  controller.close()
})

test('继续队列的迟到响应不会回退更高 QueueState revision', async () => {
  const gateway = new FakeGateway()
  const pending = deferred<AgentQueueState>()
  const turn = queuedTurnFixture()
  gateway.queuedTurnsImpl = async () => ({
    items: [turn],
    queue_state: queueStateFixture({ state: 'paused', revision: 3 }),
  })
  gateway.resumeQueueImpl = async () => pending.promise
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [], queued_turns: [turn],
    queue_state: queueStateFixture({ state: 'paused', revision: 3 }),
  })
  await waitFor(() => controller.getSnapshot().queue_states['ags-session']?.revision === 3)

  const operation = controller.resumeQueue('ags-session')
  socket.message({
    type: 'upsert', revision: 1,
    queue_state: queueStateFixture({ state: 'running', revision: 5 }),
  })
  assert.equal(controller.getSnapshot().queue_states['ags-session']?.revision, 5)
  pending.resolve(queueStateFixture({ state: 'running', revision: 4 }))
  await operation

  assert.equal(controller.getSnapshot().queue_states['ags-session']?.revision, 5)
  controller.close()
})

test('非队列 WebSocket 增量不会使运行中的队列水合作废', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().snapshot_complete)
  await waitFor(() => gateway.queuedTurnCalls >= 2)

  const pending = deferred<AgentQueuedTurnPage>()
  gateway.queuedTurnsImpl = async () => pending.promise
  const hydrationCalls = gateway.queuedTurnCalls
  controller.selectSession('ags-session')
  await waitFor(() => gateway.queuedTurnCalls > hydrationCalls)
  socket.message({
    type: 'upsert', revision: 1,
    run: agentRunFixture({ status: 'running', revision: 2 }),
  })
  const turn = queuedTurnFixture()
  pending.resolve({ items: [turn], queue_state: queueStateFixture() })

  await waitFor(() => controller.getSnapshot().queued_turns['ags-session']?.[0]?.id === turn.id)
  controller.close()
})

test('队列 WebSocket 增量会使较早开始的列表水合作废', async () => {
  const gateway = new FakeGateway()
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [agentRunFixture()],
    queued_turns: [], queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().snapshot_complete)
  await waitFor(() => gateway.queuedTurnCalls >= 2)

  const pending = deferred<AgentQueuedTurnPage>()
  gateway.queuedTurnsImpl = async () => pending.promise
  const hydrationCalls = gateway.queuedTurnCalls
  controller.selectSession('ags-session')
  await waitFor(() => gateway.queuedTurnCalls > hydrationCalls)
  const current = queuedTurnFixture({ id: 'agt-current', revision: 2 })
  socket.message({ type: 'upsert', revision: 1, queued_turn: current })
  pending.resolve({
    items: [queuedTurnFixture({ id: 'agt-stale' })],
    queue_state: queueStateFixture(),
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    controller.getSnapshot().queued_turns['ags-session']?.map(({ id }) => id),
    ['agt-current'],
  )
  controller.close()
})

test('移动排队消息使用源和目标 revision，并合并后端返回的单调顺序变更', async () => {
  const first = queuedTurnFixture({ id: 'agq-first', queue_sequence: 1, revision: 2 })
  const second = queuedTurnFixture({ id: 'agq-second', queue_sequence: 2, revision: 4 })
  const gateway = new FakeGateway()
  gateway.moveQueuedTurnImpl = async () => ({
    items: [
      { id: second.id, queue_sequence: 1, revision: 5, updated_at: '2026-09-01T00:00:01Z' },
      { id: first.id, queue_sequence: 2, revision: 3, updated_at: '2026-09-01T00:00:01Z' },
    ],
  })
  const { controller } = await startControllerWithQueue(gateway, [first, second])

  await controller.moveQueuedTurn('ags-session', second.id, first.id, 'before')

  assert.deepEqual(gateway.moveQueuedTurnRequests, [{
    id: second.id,
    input: {
      expected_revision: 4,
      target_turn_id: first.id,
      target_expected_revision: 2,
      placement: 'before',
    },
  }])
  assert.deepEqual(
    controller.getSnapshot().queued_turns['ags-session']?.map(({ id, queue_sequence, revision }) => ({
      id, queue_sequence, revision,
    })),
    [
      { id: second.id, queue_sequence: 1, revision: 5 },
      { id: first.id, queue_sequence: 2, revision: 3 },
    ],
  )
  controller.close()
})

test('移动请求在途收到队列删除事件时放弃局部响应并重新读取权威队列', async () => {
  const first = queuedTurnFixture({ id: 'agq-first', queue_sequence: 1 })
  const second = queuedTurnFixture({ id: 'agq-second', queue_sequence: 2 })
  const concurrent = queuedTurnFixture({ id: 'agq-concurrent', queue_sequence: 3 })
  const gateway = new FakeGateway()
  const pending = deferred<Awaited<ReturnType<AgentWorkspaceGateway['moveQueuedTurn']>>>()
  gateway.moveQueuedTurnImpl = async () => pending.promise
  const { controller, socket } = await startControllerWithQueue(gateway, [first, second])

  const operation = controller.moveQueuedTurn('ags-session', first.id, second.id, 'after')
  await waitFor(() => gateway.moveQueuedTurnRequests.length === 1)
  socket.message({
    type: 'removed', revision: 1, entity: 'queued_turn',
    id: first.id, session_id: first.session_id,
  })
  gateway.queuedTurnsImpl = async () => ({
    items: [second, concurrent], queue_state: queueStateFixture(),
  })
  const hydrationCalls = gateway.queuedTurnCalls
  pending.resolve({
    items: [
      { id: second.id, queue_sequence: 1, revision: 2, updated_at: '2026-09-01T00:00:01Z' },
      { id: first.id, queue_sequence: 2, revision: 2, updated_at: '2026-09-01T00:00:01Z' },
    ],
  })
  await operation

  assert.ok(gateway.queuedTurnCalls > hydrationCalls)
  assert.deepEqual(
    controller.getSnapshot().queued_turns['ags-session']?.map(({ id }) => id),
    [second.id, concurrent.id],
  )
  controller.close()
})

test('移动响应包含本地缺失项或产生重复 sequence 时重新水合', async () => {
  const scenarios = [
    {
      name: 'missing item',
      items: [{ id: 'agq-missing', queue_sequence: 1, revision: 2, updated_at: '2026-09-01T00:00:01Z' }],
    },
    {
      name: 'duplicate sequence',
      items: [{ id: 'agq-first', queue_sequence: 2, revision: 2, updated_at: '2026-09-01T00:00:01Z' }],
    },
  ]
  for (const scenario of scenarios) {
    const first = queuedTurnFixture({ id: 'agq-first', queue_sequence: 1 })
    const second = queuedTurnFixture({ id: 'agq-second', queue_sequence: 2 })
    const gateway = new FakeGateway()
    gateway.moveQueuedTurnImpl = async () => ({ items: scenario.items })
    const { controller } = await startControllerWithQueue(gateway, [first, second])
    gateway.queuedTurnsImpl = async () => ({
      items: [
        { ...second, queue_sequence: 1, revision: 2 },
        { ...first, queue_sequence: 2, revision: 2 },
      ],
      queue_state: queueStateFixture(),
    })
    const hydrationCalls = gateway.queuedTurnCalls

    await controller.moveQueuedTurn('ags-session', first.id, second.id, 'after')

    assert.ok(gateway.queuedTurnCalls > hydrationCalls, scenario.name)
    assert.deepEqual(
      controller.getSnapshot().queued_turns['ags-session']?.map(({ id }) => id),
      [second.id, first.id],
      scenario.name,
    )
    controller.close()
  }
})

test('移动 revision 冲突时先恢复权威顺序再向调用方保留原错误', async () => {
  const first = queuedTurnFixture({ id: 'agq-first', queue_sequence: 1 })
  const second = queuedTurnFixture({ id: 'agq-second', queue_sequence: 2 })
  const gateway = new FakeGateway()
  const conflict = Object.assign(new Error('revision conflict'), { code: 'AGENT_REVISION_CONFLICT' })
  gateway.moveQueuedTurnImpl = async () => { throw conflict }
  const { controller } = await startControllerWithQueue(gateway, [first, second])
  gateway.queuedTurnsImpl = async () => ({
    items: [
      { ...second, queue_sequence: 1, revision: 2 },
      { ...first, queue_sequence: 2, revision: 2 },
    ],
    queue_state: queueStateFixture(),
  })
  const hydrationCalls = gateway.queuedTurnCalls

  await assert.rejects(
    controller.moveQueuedTurn('ags-session', first.id, second.id, 'after'),
    (error: unknown) => error === conflict,
  )

  assert.ok(gateway.queuedTurnCalls > hydrationCalls)
  assert.deepEqual(
    controller.getSnapshot().queued_turns['ags-session']?.map(({ id }) => id),
    [second.id, first.id],
  )
  controller.close()
})

test('队列分页因并发重排发生 revision 冲突时从首页有限重试', async () => {
  const initial = queuedTurnFixture({ id: 'agq-initial', queue_sequence: 1 })
  const authoritative = queuedTurnFixture({ id: 'agq-authoritative', queue_sequence: 1, revision: 2 })
  const gateway = new FakeGateway()
  const { controller } = await startControllerWithQueue(gateway, [initial])
  let calls = 0
  gateway.queuedTurnsImpl = async (_sessionId, options) => {
    calls += 1
    if (calls === 1) {
      assert.equal(options?.cursor, undefined)
      return { items: [initial], next_cursor: 'stale-cursor' }
    }
    if (calls === 2) {
      assert.equal(options?.cursor, 'stale-cursor')
      throw Object.assign(new Error('revision conflict'), { code: 'AGENT_REVISION_CONFLICT' })
    }
    assert.equal(options?.cursor, undefined)
    return { items: [authoritative], queue_state: queueStateFixture() }
  }

  controller.selectSession('ags-session')
  await waitFor(() => (
    controller.getSnapshot().queued_turns['ags-session']?.[0]?.id === authoritative.id
  ))

  assert.equal(calls, 3)
  controller.close()
})

test('队列分页拒绝跨页重复 ID 或 sequence', async () => {
  const first = queuedTurnFixture({ id: 'agq-first', queue_sequence: 1 })
  const duplicateSequence = queuedTurnFixture({ id: 'agq-second', queue_sequence: 1 })
  const gateway = new FakeGateway()
  const { controller } = await startControllerWithQueue(gateway, [first])
  gateway.queuedTurnsImpl = async (_sessionId, options) => options?.cursor
    ? { items: [duplicateSequence], queue_state: queueStateFixture() }
    : { items: [first], next_cursor: 'next-page' }

  controller.selectSession('ags-session')
  await waitFor(() => controller.getSnapshot().error_code === 'AGENT_QUEUE_PAGE_INVALID')

  assert.equal(controller.getSnapshot().phase, 'degraded')
  assert.deepEqual(controller.getSnapshot().queued_turns['ags-session']?.map(({ id }) => id), [first.id])
  controller.close()
})

class FakeGateway implements AgentWorkspaceGateway {
  readonly sessionSignals: AbortSignal[] = []
  readonly messageSignals: AbortSignal[] = []
  readonly contextSignals: AbortSignal[] = []
  readonly usageSignals: AbortSignal[] = []
  readonly runSignals: Array<AbortSignal | undefined> = []
  readonly runEventRequests: AgentRunEventListOptions[] = []
  readonly started: Array<{ run_id: string; generation: number }> = []
  readonly stopped: Array<{ run_id: string; generation: number }> = []
  readonly steered: Array<{ run_id: string; generation: number; message: string }> = []
  readonly stopRequests: Array<{
    id: string
    expectedRevision: number
    expectedGeneration: number
  }> = []
  readonly createRunRequests: AgentCreateRunInput[] = []
  readonly enqueueTurnRequests: Array<{
    sessionId: string
    input: Parameters<AgentWorkspaceGateway['enqueueTurn']>[1]
  }> = []
  readonly moveQueuedTurnRequests: Array<{
    id: string
    input: Parameters<AgentWorkspaceGateway['moveQueuedTurn']>[1]
  }> = []
  createRunImpl: (sessionId: string, input: AgentCreateRunInput) => Promise<AgentRun> = async () => (
    agentRunFixture()
  )
  runCalls = 0
  contextCalls = 0
  usageCalls = 0
  queuedTurnCalls = 0
  startResult: AgentRuntimeCommandResult | Promise<AgentRuntimeCommandResult> = commandResult(true)
  stopResult: AgentRuntimeCommandResult | Promise<AgentRuntimeCommandResult> = commandResult(true)
  stopRunImpl: (
    id: string,
    expectedRevision: number,
    expectedGeneration: number,
  ) => Promise<AgentRun> = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'stopping', revision: expectedRevision + 1 })
  )
  sessionsImpl: (options: AgentSessionListOptions) => Promise<AgentSessionPage> = async (options) => {
    if (options.signal) this.sessionSignals.push(options.signal)
    return { items: [agentSessionFixture()] }
  }
  sessionImpl: (id: string, signal?: AbortSignal) => Promise<AgentSession> = async () => (
    agentSessionFixture()
  )
  messagesImpl: (sessionId: string, options: AgentMessageListOptions) => Promise<AgentMessagePage> = async (sessionId, options) => {
    assert.equal(sessionId, 'ags-session')
    if (options.signal) this.messageSignals.push(options.signal)
    return { items: [agentMessageFixture()] }
  }
  runImpl: (id: string, signal?: AbortSignal) => Promise<AgentRun> = async (id, signal) => {
    assert.equal(id, 'agr-run')
    this.runSignals.push(signal)
    this.runCalls += 1
    return agentRunFixture()
  }
  contextImpl: (sessionId: string, signal?: AbortSignal) => Promise<AgentSessionContext> = async () => contextFixture()
  usageImpl: (sessionId: string, signal?: AbortSignal) => Promise<AgentSessionUsage> = async (sessionId) => (
    usageFixture({ session_id: sessionId })
  )
  queuedTurnsImpl: AgentWorkspaceGateway['queuedTurns'] = async () => ({ items: [] })
  enqueueTurnImpl: AgentWorkspaceGateway['enqueueTurn'] = async (_sessionId, input) => (
    queuedTurnFixture({ client_request_id: input.client_request_id })
  )
  moveQueuedTurnImpl: AgentWorkspaceGateway['moveQueuedTurn'] = async () => ({ items: [] })
  resumeQueueImpl: AgentWorkspaceGateway['resumeQueue'] = async (sessionId, expectedRevision) => (
    queueStateFixture({ session_id: sessionId, state: 'running', revision: expectedRevision + 1 })
  )

  sessions(options: AgentSessionListOptions = {}) {
    if (options.signal && !this.sessionSignals.includes(options.signal)) this.sessionSignals.push(options.signal)
    return this.sessionsImpl(options)
  }

  session(id: string, signal?: AbortSignal) { return this.sessionImpl(id, signal) }
  async createSession(input: Parameters<AgentWorkspaceGateway['createSession']>[0]) {
    return agentSessionFixture({
      title: input.title,
      model_id: input.model_id,
      reasoning_level: input.reasoning_level,
    })
  }
  async updateSession(_id: string, input: Parameters<AgentWorkspaceGateway['updateSession']>[1]) {
    return agentSessionFixture({
      title: input.title,
      model_id: input.model_id,
      reasoning_level: input.reasoning_level,
      archived_at: input.archived ? agentSessionFixture().updated_at : undefined,
      revision: input.expected_revision + 1,
    })
  }
  async deleteSession() {}
  async uploadAttachment(): Promise<never> { throw new Error('not implemented') }
  async attachment(): Promise<never> { throw new Error('not implemented') }
  async attachmentContent(): Promise<Blob> { throw new Error('not implemented') }
  async deleteAttachment() {}
  messages(sessionId: string, options: AgentMessageListOptions = {}) {
    if (options.signal && !this.messageSignals.includes(options.signal)) this.messageSignals.push(options.signal)
    return this.messagesImpl(sessionId, options)
  }
  context(sessionId: string, signal?: AbortSignal) {
    assert.equal(sessionId, 'ags-session')
    if (signal) this.contextSignals.push(signal)
    this.contextCalls += 1
    return this.contextImpl(sessionId, signal)
  }
  queuedTurns(sessionId: string, options: Parameters<AgentWorkspaceGateway['queuedTurns']>[1] = {}) {
    this.queuedTurnCalls += 1
    return this.queuedTurnsImpl(sessionId, options)
  }
  enqueueTurn(
    sessionId: string,
    input: Parameters<AgentWorkspaceGateway['enqueueTurn']>[1],
    signal?: AbortSignal,
  ) {
    this.enqueueTurnRequests.push({ sessionId, input })
    return this.enqueueTurnImpl(sessionId, input, signal)
  }
  async beginQueuedTurnEdit(): Promise<never> { throw new Error('not implemented') }
  async updateQueuedTurn(): Promise<never> { throw new Error('not implemented') }
  async cancelQueuedTurnEdit(): Promise<never> { throw new Error('not implemented') }
  async deleteQueuedTurn() { return queuedTurnFixture({ state: 'cancelled' }) }
  moveQueuedTurn(
    id: string,
    input: Parameters<AgentWorkspaceGateway['moveQueuedTurn']>[1],
    signal?: AbortSignal,
  ) {
    this.moveQueuedTurnRequests.push({ id, input })
    return this.moveQueuedTurnImpl(id, input, signal)
  }
  async steerQueuedTurn() { return commandResult(true) }
  resumeQueue(sessionId: string, expectedRevision: number, signal?: AbortSignal) {
    return this.resumeQueueImpl(sessionId, expectedRevision, signal)
  }
  async wakeQueue() { return commandResult(true) }
  async replaceResourceBinding() { return agentSessionFixture() }
  async removeResourceBinding() { return agentSessionFixture() }
  usage(sessionId: string, signal?: AbortSignal) {
    if (signal) this.usageSignals.push(signal)
    this.usageCalls += 1
    return this.usageImpl(sessionId, signal)
  }
  async createRun(sessionId: string, input: AgentCreateRunInput) {
    this.createRunRequests.push(input)
    return this.createRunImpl(sessionId, input)
  }
  run(id: string, signal?: AbortSignal) { return this.runImpl(id, signal) }
  async stopRun(id: string, expectedRevision: number, expectedGeneration: number) {
    this.stopRequests.push({ id, expectedRevision, expectedGeneration })
    return this.stopRunImpl(id, expectedRevision, expectedGeneration)
  }
  async runEvents(_id: string, options: AgentRunEventListOptions): Promise<AgentRunEventPage> {
    this.runEventRequests.push(options)
    return { items: [] }
  }
  eventsUrl() { return 'ws://127.0.0.1:8122/api/v1/agent/events' }
  async runtimeStatus() { return runtimeStatus() }
  async startRuntime(run: Pick<AgentRun, 'id' | 'generation'>) {
    this.started.push({ run_id: run.id, generation: run.generation })
    return this.startResult
  }
  async stopRuntime(run: Pick<AgentRun, 'id' | 'generation'>) {
    this.stopped.push({ run_id: run.id, generation: run.generation })
    return this.stopResult
  }
  async steerRuntime(run: Pick<AgentRun, 'id' | 'generation'>, message: string) {
    this.steered.push({ run_id: run.id, generation: run.generation, message })
    return commandResult(true)
  }
  onRuntimeStatus() { return () => undefined }
  async updateMcpPolicy(): Promise<AgentMcpPolicy> {
    return {
      client_id: 'mcp-client', approval_bypass: false, scope_count: 29,
      required_scope_count: 29, scope_sync_required: false, revision: 1,
    }
  }
}

class FakeSocket extends EventTarget {
  readyState = 0
  closed = false

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  message(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

function sessionInput() {
  return { title: '测试会话', model_id: 'apm-model', reasoning_level: 'medium' as const }
}

function runtimeStatus(): AgentRuntimeStatus {
  return { state: 'ready' }
}

function commandResult(accepted: boolean, errorCode?: string): AgentRuntimeCommandResult {
  return { accepted, status: runtimeStatus(), error_code: errorCode }
}

function contextFixture(overrides: Partial<AgentSessionContext> = {}): AgentSessionContext {
  return {
    session_id: 'ags-session',
    estimated_tokens: 24_000,
    context_window_tokens: 32_768,
    estimated: true,
    warning: true,
    compression_available: true,
    ...overrides,
  }
}

function queuedTurnFixture(overrides: Partial<AgentQueuedTurn> = {}): AgentQueuedTurn {
  return {
    id: 'agq-turn', session_id: 'ags-session', client_request_id: 'request-turn',
    queue_sequence: 1, prompt: '排队消息', model_id: 'apm-model', reasoning_level: 'medium',
    force_context_compression: false, state: 'queued', editing: false, revision: 1,
    created_at: agentFixtureTime, updated_at: agentFixtureTime, attachments: [],
    ...overrides,
  }
}

function queueStateFixture(overrides: Partial<AgentQueueState> = {}): AgentQueueState {
  return {
    session_id: 'ags-session', state: 'running', revision: 1,
    ...overrides,
  }
}

async function startControllerWithQueue(gateway: FakeGateway, turns: AgentQueuedTurn[]) {
  gateway.queuedTurnsImpl = async () => ({ items: turns, queue_state: queueStateFixture() })
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => controller.getSnapshot().selected_session_id === 'ags-session')
  socket.open()
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()], active_runs: [],
    queued_turns: turns, queue_state: queueStateFixture(),
  })
  await waitFor(() => controller.getSnapshot().snapshot_complete)
  await waitFor(() => (
    controller.getSnapshot().queued_turns['ags-session']?.length === turns.length
  ))
  return { controller, socket }
}

function usageFixture(overrides: Partial<AgentSessionUsage> = {}): AgentSessionUsage {
  return {
    session_id: 'ags-session',
    run_count: 2,
    input_tokens: 1_000,
    output_tokens: 240,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 120,
    total_tokens: 1_240,
    estimated: false,
    updated_at: agentFixtureTime,
    ...overrides,
  }
}

function usageEventResponse(
  sequence: number,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
) {
  return {
    id: `age-usage-${sequence}`,
    run_id: 'agr-run',
    generation: 1,
    sequence,
    kind: 'usage',
    payload: {
      usage: {
        input_tokens: inputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        output_tokens: outputTokens,
        reasoning_tokens: Math.floor(outputTokens / 2),
        total_tokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
        estimated: false,
      },
    },
    created_at: agentFixtureTime,
  }
}

function startedController(gateway: FakeGateway) {
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
  })
  controller.start()
  return controller
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function abortable<Value>(pending: ReturnType<typeof deferred<Value>>, signal?: AbortSignal) {
  if (!signal) return pending.promise
  if (signal.aborted) return Promise.reject(abortError())
  signal.addEventListener('abort', () => pending.reject(abortError()), { once: true })
  return pending.promise
}

function abortError() {
  return Object.assign(new Error('请求已取消'), { code: 'REQUEST_ABORTED' })
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return
    await settle()
  }
  assert.fail('等待异步状态超时')
}
