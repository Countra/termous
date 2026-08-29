import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentRuntimeProtocolVersion,
  type AgentRuntimeRunRef,
  type AgentSkillsBundleStatus,
} from '#common/contracts'
import type {
  AgentCoreRuntimePort,
  AgentRuntimeFailureCategory,
  AgentSupervisorLease,
} from './coreRuntimeClient.ts'
import { AgentSupervisor } from './supervisor.ts'
import type { AgentWorkerFactory, AgentWorkerProcess } from './workerProcess.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'

const primaryRun = { run_id: 'agr_primary', generation: 1 } as const

function skillStatus(): AgentSkillsBundleStatus {
  const snapshot = testAgentSkillBundle()
  return {
    status: 'ready',
    fingerprint: snapshot.fingerprint,
    skill_count: snapshot.catalog.length,
    resource_count: snapshot.resources.length,
  }
}

class FakeCore implements AgentCoreRuntimePort {
  lease: AgentSupervisorLease = {
    core_instance_id: 'core-1',
    supervisor_instance_id: 'supervisor-1',
    runtime_protocol_version: agentRuntimeProtocolVersion,
    revision: 1,
    expires_at: '2030-01-01T00:00:00Z',
  }
  failures: Array<AgentRuntimeRunRef & { category: AgentRuntimeFailureCategory }> = []
  ticketCalls = 0
  unregisterCalls = 0
  registerError: Error | null = null
  baseURLError: Error | null = null
  skillsStatuses: AgentSkillsBundleStatus[] = []

  async registerSupervisor(
    supervisorInstanceID: string,
    skillsBundle: AgentSkillsBundleStatus,
  ) {
    if (this.registerError) {
      throw this.registerError
    }
    this.lease = {
      ...this.lease,
      supervisor_instance_id: supervisorInstanceID,
      revision: this.lease.revision + 1,
    }
    this.skillsStatuses.push(skillsBundle)
    return this.lease
  }

  async unregisterSupervisor() {
    this.unregisterCalls += 1
  }

  async issueRuntimeTicket(_supervisorInstanceID: string, runID: string, generation: number) {
    this.ticketCalls += 1
    return {
      ticket: 'runtime-ticket-value-with-at-least-forty-bytes-123456',
      run_id: runID,
      generation,
      core_instance_id: this.lease.core_instance_id,
      expires_at: '2030-01-01T00:00:00Z',
    }
  }

  async reportRuntimeFailure(
    _supervisorInstanceID: string,
    runID: string,
    generation: number,
    category: AgentRuntimeFailureCategory,
  ) {
    this.failures.push({ run_id: runID, generation, category })
  }

  async currentBaseURL() {
    if (this.baseURLError) {
      throw this.baseURLError
    }
    return 'http://127.0.0.1:8122/'
  }
}

class FakeWorker implements AgentWorkerProcess {
  sent: unknown[] = []
  killed = false
  private messageListeners = new Set<(message: unknown) => void>()
  private exitListeners = new Set<(code: number) => void>()
  private spawnListeners = new Set<() => void>()

  postMessage(message: unknown) {
    this.sent.push(message)
  }

  kill() {
    this.killed = true
    this.emitExit(9)
    return true
  }

  onMessage(listener: (message: unknown) => void) {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onExit(listener: (code: number) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  onSpawn(listener: () => void) {
    this.spawnListeners.add(listener)
    return () => this.spawnListeners.delete(listener)
  }

  emitSpawn() {
    for (const listener of this.spawnListeners) listener()
  }

  emitMessage(message: unknown) {
    for (const listener of this.messageListeners) listener(message)
  }

  emitExit(code = 0) {
    for (const listener of [...this.exitListeners]) listener(code)
  }
}

class FakeWorkerFactory implements AgentWorkerFactory {
  workers: FakeWorker[] = []
  createError: Error | null = null

  create() {
    if (this.createError) {
      throw this.createError
    }
    const worker = new FakeWorker()
    this.workers.push(worker)
    return worker
  }
}

function createFixture(options: { steerAckTimeoutMs?: number } = {}) {
  const core = new FakeCore()
  const factory = new FakeWorkerFactory()
  const skills = {
    inspect: async () => skillStatus(),
    snapshot: async () => testAgentSkillBundle(),
  }
  const supervisor = new AgentSupervisor({
    core,
    workerFactory: factory,
    skills,
    newInstanceID: () => 'supervisor-1',
    leaseRefreshIntervalMs: 60_000,
    workerAbortGraceMs: 5,
    workerKillWaitMs: 5,
    settledExitGraceMs: 5,
    steerAckTimeoutMs: options.steerAckTimeoutMs,
  })
  return { core, factory, skills, supervisor }
}

async function flushSupervisor() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('Supervisor 仅接管一个 Run 并隔离旧 generation 消息', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()

  assert.equal((await supervisor.startRun(primaryRun)).accepted, true)
  const worker = factory.workers[0]
  assert.equal(core.ticketCalls, 0)
  worker.emitSpawn()
  await flushSupervisor()
  assert.deepEqual(worker.sent[0], {
    type: 'start',
    protocol_version: agentRuntimeProtocolVersion,
    core_base_url: 'http://127.0.0.1:8122/',
    ticket: 'runtime-ticket-value-with-at-least-forty-bytes-123456',
    run_id: primaryRun.run_id,
    generation: primaryRun.generation,
    skills: testAgentSkillBundle(),
  })
  assert.equal((await supervisor.startRun(primaryRun)).accepted, true)
  assert.equal(core.ticketCalls, 1)
  assert.equal((await supervisor.startRun({ run_id: 'agr_other', generation: 1 })).accepted, false)

  worker.emitMessage({
    type: 'started', protocol_version: agentRuntimeProtocolVersion, run_id: primaryRun.run_id, generation: 2,
  })
  await flushSupervisor()
  assert.equal(supervisor.getStatus().state, 'starting')
  worker.emitMessage({
    type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun,
  })
  await flushSupervisor()
  assert.equal(supervisor.getStatus().state, 'running')

  worker.emitMessage({
    type: 'settled', protocol_version: agentRuntimeProtocolVersion, ...primaryRun, outcome: 'completed',
  })
  worker.emitExit(0)
  await flushSupervisor()
  assert.equal(supervisor.getStatus().state, 'ready')
  assert.deepEqual(core.failures, [])
  await supervisor.shutdown()
})

test('Supervisor 在 5 秒协作预算耗尽后强制结束并只上报一次', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()

  const result = await supervisor.stopRun(primaryRun)
  assert.equal(result.accepted, true)
  assert.equal(worker.killed, true)
  assert.deepEqual(worker.sent[worker.sent.length - 1], { type: 'abort', ...primaryRun })
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'forced_stop' }])
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
  assert.equal(core.unregisterCalls, 1)
})

test('Supervisor 将异常退出收口为 worker_crash 且不接受迟到消息', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({
    type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun,
  })
  await flushSupervisor()
  worker.emitExit(7)
  await flushSupervisor()

  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'worker_crash' }])
  assert.equal(supervisor.getStatus().state, 'ready')
  worker.emitMessage({
    type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun,
  })
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('Supervisor 将 Worker 启动完成前的退出分类为 launch_failed', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitExit(7)
  await flushSupervisor()

  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'launch_failed' }])
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('Skills ready 租约后快照失败会终止排队 Run 并立即降级租约', async () => {
  const { core, skills, supervisor } = createFixture()
  await supervisor.initialize()
  skills.snapshot = async () => { throw new Error('snapshot failed') }

  const result = await supervisor.startRun(primaryRun)

  assert.equal(result.accepted, false)
  assert.equal(result.error_code, 'AGENT_RUNTIME_LAUNCH_FAILED')
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'launch_failed' }])
  assert.deepEqual(core.skillsStatuses[core.skillsStatuses.length - 1], {
    status: 'unavailable',
    fingerprint: '',
    skill_count: 0,
    resource_count: 0,
    error_category: 'snapshot_failed',
  })
  assert.deepEqual(supervisor.getStatus(), {
    state: 'offline',
    error_code: 'AGENT_SKILLS_BUNDLE_NOT_READY',
  })
  await supervisor.shutdown()
})

test('非 Skills 启动失败不污染 Skills readiness', async () => {
  const cases = [
    {
      name: 'Core URL',
      fail: ({ core }: ReturnType<typeof createFixture>) => {
        core.baseURLError = new Error('base URL failed')
      },
    },
    {
      name: 'Worker create',
      fail: ({ factory }: ReturnType<typeof createFixture>) => {
        factory.createError = new Error('worker create failed')
      },
    },
  ]

  for (const scenario of cases) {
    const fixture = createFixture()
    await fixture.supervisor.initialize()
    scenario.fail(fixture)

    const result = await fixture.supervisor.startRun(primaryRun)

    assert.equal(result.accepted, false, scenario.name)
    assert.equal(result.error_code, 'AGENT_RUNTIME_LAUNCH_FAILED', scenario.name)
    assert.deepEqual(
      fixture.core.failures,
      [{ ...primaryRun, category: 'launch_failed' }],
      scenario.name,
    )
    assert.equal(fixture.core.skillsStatuses.length, 2, scenario.name)
    assert.equal(
      fixture.core.skillsStatuses.every((status) => status.status === 'ready'),
      true,
      scenario.name,
    )
    assert.deepEqual(
      fixture.core.skillsStatuses[fixture.core.skillsStatuses.length - 1],
      skillStatus(),
      scenario.name,
    )
    assert.deepEqual(fixture.supervisor.getStatus(), {
      state: 'ready',
      error_code: 'AGENT_RUNTIME_LAUNCH_FAILED',
    }, scenario.name)
    await fixture.supervisor.shutdown()
  }
})

test('Supervisor 只在 Worker 进入 running 后接受 steer', async () => {
  const { factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()

  assert.equal((await supervisor.steerRun({ ...primaryRun, message: '追加指令' })).accepted, false)
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()
  const steering = supervisor.steerRun({ ...primaryRun, message: '追加指令' })
  await flushSupervisor()
  const steer = worker.sent[worker.sent.length - 1] as {
    type: string
    client_request_id: string
  }
  assert.equal(steer.type, 'steer')
  assert.match(steer.client_request_id, /^agsr_[A-Za-z0-9-]+$/)
  worker.emitMessage({
    type: 'steer_ack',
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    client_request_id: steer.client_request_id,
    accepted: true,
  })
  assert.equal((await steering).accepted, true)
  await supervisor.shutdown()
})

test('终态冻结会明确拒绝在途 steer，重复和迟到 ack 不会污染后续请求', async () => {
  const { factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()

  const firstPending = supervisor.steerRun({ ...primaryRun, message: '终态边界指令' })
  await flushSupervisor()
  const first = worker.sent[worker.sent.length - 1] as { client_request_id: string }
  worker.emitMessage({
    type: 'settled',
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    outcome: 'completed',
  })
  const firstResult = await firstPending
  assert.equal(firstResult.accepted, false)
  assert.equal(firstResult.error_code, 'AGENT_RUNTIME_RUN_NOT_ACTIVE')

  const lateAck = {
    type: 'steer_ack' as const,
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    client_request_id: first.client_request_id,
    accepted: true,
  }
  worker.emitMessage(lateAck)
  worker.emitMessage(lateAck)
  worker.emitExit(0)
  await flushSupervisor()
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('stop 可立即取消等待 ack 的 steer 且 Worker 退出后不遗留请求', async () => {
  const { factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()

  const steering = supervisor.steerRun({ ...primaryRun, message: '等待确认' })
  await flushSupervisor()
  const stopping = supervisor.stopRun(primaryRun)
  const [steerResult, stopResult] = await Promise.all([steering, stopping])

  assert.equal(steerResult.accepted, false)
  assert.equal(steerResult.error_code, 'AGENT_RUNTIME_RUN_NOT_ACTIVE')
  assert.equal(stopResult.accepted, true)
  assert.equal(worker.killed, true)
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('Worker 崩溃会拒绝等待 ack 的 steer 并恢复 Supervisor 空闲状态', async () => {
  const { factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()

  const steering = supervisor.steerRun({ ...primaryRun, message: '崩溃边界指令' })
  await flushSupervisor()
  worker.emitExit(7)
  const result = await steering
  await flushSupervisor()

  assert.equal(result.accepted, false)
  assert.equal(result.error_code, 'AGENT_RUNTIME_WORKER_UNAVAILABLE')
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('steer 确认超时后忽略迟到 ack，且不污染下一次请求', async () => {
  const { factory, supervisor } = createFixture({ steerAckTimeoutMs: 50 })
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()

  const firstPending = supervisor.steerRun({ ...primaryRun, message: '超时指令' })
  await flushSupervisor()
  const first = worker.sent[worker.sent.length - 1] as { client_request_id: string }
  const firstResult = await firstPending
  assert.equal(firstResult.accepted, false)
  assert.equal(firstResult.error_code, 'AGENT_RUNTIME_STEER_ACK_TIMEOUT')

  worker.emitMessage({
    type: 'steer_ack',
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    client_request_id: first.client_request_id,
    accepted: true,
  })
  const secondPending = supervisor.steerRun({ ...primaryRun, message: '后续指令' })
  await flushSupervisor()
  const second = worker.sent[worker.sent.length - 1] as { client_request_id: string }
  assert.notEqual(second.client_request_id, first.client_request_id)
  worker.emitMessage({
    type: 'steer_ack',
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    client_request_id: second.client_request_id,
    accepted: true,
  })
  assert.equal((await secondPending).accepted, true)
  await supervisor.shutdown()
})

test('Worker 在停止期间先写入终态再退出时不误报强制终止', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.emitMessage({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...primaryRun })
  await flushSupervisor()
  const originalPostMessage = worker.postMessage.bind(worker)
  worker.postMessage = (message) => {
    originalPostMessage(message)
    if ((message as { type?: string }).type === 'abort') {
      worker.emitMessage({
        type: 'settled', protocol_version: agentRuntimeProtocolVersion, ...primaryRun, outcome: 'cancelled',
      })
      worker.emitExit(0)
    }
  }

  assert.equal((await supervisor.stopRun(primaryRun)).accepted, true)
  assert.deepEqual(core.failures, [])
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('租约过期且续租失败时立即收口活动 Worker', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  core.lease.expires_at = '2000-01-01T00:00:00Z'
  core.registerError = new Error('AGENT_RUNTIME_UNAVAILABLE')

  await supervisor.initialize()

  assert.equal(worker.killed, true)
  assert.equal(supervisor.getStatus().state, 'offline')
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'forced_stop' }])
  await supervisor.shutdown()
})

test('Supervisor 隔离状态订阅异常并幂等处理重复 fatal', async () => {
  const { core, factory, supervisor } = createFixture()
  supervisor.subscribe(() => {
    throw new Error('listener failed')
  })
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()

  const fatal = {
    type: 'fatal',
    protocol_version: agentRuntimeProtocolVersion,
    ...primaryRun,
    category: 'runtime_failed',
  }
  worker.emitMessage(fatal)
  worker.emitMessage(fatal)
  await flushSupervisor()
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'worker_crash' }])
  worker.emitExit(1)
  await flushSupervisor()
  await supervisor.shutdown()
})

test('Worker 强杀失败时保留占用并拒绝启动第二个 Run', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()
  worker.kill = () => {
    worker.killed = true
    return false
  }

  const stopped = await supervisor.stopRun(primaryRun)
  assert.equal(stopped.accepted, true)
  assert.equal(supervisor.getStatus().state, 'stopping')
  assert.equal((await supervisor.startRun({ run_id: 'agr_second', generation: 1 })).accepted, false)
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'forced_stop' }])

  worker.emitExit(9)
  await flushSupervisor()
  assert.equal(supervisor.getStatus().state, 'ready')
  await supervisor.shutdown()
})

test('Core instance 换代时先停止旧 Worker 再恢复 ready', async () => {
  const { core, factory, supervisor } = createFixture()
  await supervisor.initialize()
  await supervisor.startRun(primaryRun)
  const worker = factory.workers[0]
  worker.emitSpawn()
  await flushSupervisor()

  core.lease = {
    ...core.lease,
    core_instance_id: 'core-2',
  }
  await supervisor.initialize()

  assert.equal(worker.killed, true)
  assert.equal(supervisor.getStatus().state, 'ready')
  assert.deepEqual(core.failures, [{ ...primaryRun, category: 'forced_stop' }])
  await supervisor.shutdown()
})
