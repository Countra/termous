import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentMcpPolicy,
  AgentMessagePage,
  AgentModelProfilePage,
  AgentRun,
  AgentRunEventPage,
  AgentSessionPage,
} from '#entities/agent'
import type { AgentRuntimeCommandResult, AgentRuntimeStatus } from '#common/contracts'
import type {
  AgentMessageListOptions,
  AgentRunEventListOptions,
  AgentSessionListOptions,
  AgentWorkspaceGateway,
} from '../api/agentRuntimeGateway.ts'
import {
  agentMessageFixture,
  agentRunFixture,
  agentSessionFixture,
  agentStatusEventFixture,
} from '../model/agentRuntimeTestFixtures.ts'
import { AgentWorkspaceController, AgentWorkspaceControllerError } from './AgentWorkspaceController.ts'

test('Runtime 启动拒绝时保留草稿，成功后才清空', async () => {
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
    (error: unknown) => error instanceof AgentWorkspaceControllerError
      && error.code === 'AGENT_RUNTIME_START_REJECTED',
  )
  assert.equal(rejected.getSnapshot().drafts[session.id]?.text, '保留的请求')
  assert.equal(rejected.getSnapshot().runs['agr-run']?.status, 'cancelled')
  assert.deepEqual(rejectedGateway.stopRequests, [{ id: 'agr-run', expectedRevision: 1 }])
  assert.deepEqual(rejectedGateway.stopped, [])

  const acceptedGateway = new FakeGateway()
  const accepted = new AgentWorkspaceController({ gateway: acceptedGateway })
  const acceptedSession = await accepted.createSession(sessionInput())
  accepted.updateDraft(acceptedSession.id, '正常请求')
  await accepted.startRun(acceptedSession.id, '正常请求')
  assert.equal(accepted.getSnapshot().drafts[acceptedSession.id], undefined)
  assert.deepEqual(acceptedGateway.started, [{ run_id: 'agr-run', generation: 1 }])
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
  assert.deepEqual(gateway.stopRequests, [{ id: 'agr-run', expectedRevision: 1 }])
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

test('steer 与 stop 使用当前 Run 的 ID、generation 和 revision', async () => {
  const gateway = new FakeGateway()
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  await controller.steerActiveRun('补充约束')
  await controller.stopActiveRun()

  assert.deepEqual(gateway.steered, [{ run_id: 'agr-run', generation: 1, message: '补充约束' }])
  assert.deepEqual(gateway.stopped, [{ run_id: 'agr-run', generation: 1 }])
  assert.deepEqual(gateway.stopRequests, [{ id: 'agr-run', expectedRevision: 1 }])
})

test('停止 queued 或已终态 Run 时不调用不存在的 Worker', async () => {
  const gateway = new FakeGateway()
  gateway.stopRunImpl = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'cancelled', revision: expectedRevision + 1 })
  )
  const controller = new AgentWorkspaceController({ gateway })
  const session = await controller.createSession(sessionInput())
  await controller.startRun(session.id, '执行任务')

  const stopped = await controller.stopActiveRun()

  assert.equal(stopped?.status, 'cancelled')
  assert.deepEqual(gateway.stopped, [])
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
  const socket = new FakeSocket()
  const controller = new AgentWorkspaceController({
    gateway,
    socketFactory: () => socket as unknown as WebSocket,
  })
  controller.start()
  await waitFor(() => gateway.messageSignals.length === 1)
  socket.message({
    type: 'snapshot', revision: 0,
    sessions: [agentSessionFixture()],
    active_runs: [agentRunFixture({ event_sequence: 1 })],
  })
  await waitFor(() => gateway.runSignals.length === 1)

  controller.close()
  assert.equal(gateway.messageSignals[0]?.aborted, true)
  assert.equal(gateway.runSignals[0]?.aborted, true)
  assert.equal(controller.getSnapshot().phase, 'idle')
  await settle()
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

class FakeGateway implements AgentWorkspaceGateway {
  readonly sessionSignals: AbortSignal[] = []
  readonly messageSignals: AbortSignal[] = []
  readonly runSignals: Array<AbortSignal | undefined> = []
  readonly runEventRequests: AgentRunEventListOptions[] = []
  readonly started: Array<{ run_id: string; generation: number }> = []
  readonly stopped: Array<{ run_id: string; generation: number }> = []
  readonly steered: Array<{ run_id: string; generation: number; message: string }> = []
  readonly stopRequests: Array<{ id: string; expectedRevision: number }> = []
  runCalls = 0
  startResult: AgentRuntimeCommandResult | Promise<AgentRuntimeCommandResult> = commandResult(true)
  stopResult: AgentRuntimeCommandResult | Promise<AgentRuntimeCommandResult> = commandResult(true)
  stopRunImpl: (id: string, expectedRevision: number) => Promise<AgentRun> = async (_id, expectedRevision) => (
    agentRunFixture({ status: 'stopping', revision: expectedRevision + 1 })
  )
  sessionsImpl: (options: AgentSessionListOptions) => Promise<AgentSessionPage> = async (options) => {
    if (options.signal) this.sessionSignals.push(options.signal)
    return { items: [agentSessionFixture()] }
  }
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

  sessions(options: AgentSessionListOptions = {}) {
    if (options.signal && !this.sessionSignals.includes(options.signal)) this.sessionSignals.push(options.signal)
    return this.sessionsImpl(options)
  }

  async session() { return agentSessionFixture() }
  async createSession(input: { title: string; model_profile_id: string; reasoning_level: 'medium' }) {
    return agentSessionFixture({
      title: input.title,
      model_profile_id: input.model_profile_id,
      reasoning_level: input.reasoning_level,
    })
  }
  async updateSession(_id: string, input: Parameters<AgentWorkspaceGateway['updateSession']>[1]) {
    return agentSessionFixture({
      title: input.title,
      model_profile_id: input.model_profile_id,
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
  async createRun() { return agentRunFixture() }
  run(id: string, signal?: AbortSignal) { return this.runImpl(id, signal) }
  async stopRun(id: string, expectedRevision: number) {
    this.stopRequests.push({ id, expectedRevision })
    return this.stopRunImpl(id, expectedRevision)
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
  async modelProfiles(): Promise<AgentModelProfilePage> { return { items: [] } }
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
  return { title: '测试会话', model_profile_id: 'amp-model', reasoning_level: 'medium' as const }
}

function runtimeStatus(): AgentRuntimeStatus {
  return { state: 'ready' }
}

function commandResult(accepted: boolean, errorCode?: string): AgentRuntimeCommandResult {
  return { accepted, status: runtimeStatus(), error_code: errorCode }
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
