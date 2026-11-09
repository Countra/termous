import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { agentRuntimeProtocolVersion, type AgentRuntimeWorkerStatus } from '#common/contracts'
import type { AgentWorkerProcess } from '../contracts/workerProcess.ts'
import type { AgentRuntimeFailureCategory } from '../contracts/supervisorCore.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { AgentRunWorker } from './runWorker.ts'

const request = { run_id: 'agr_startup', generation: 1 }

class StartupProcess implements AgentWorkerProcess {
  messages: unknown[] = []
  kills = 0
  confirmKill = true
  spawn?: () => void
  exit?: (code: number) => void
  message?: (value: unknown) => void
  postMessage(value: unknown) { this.messages.push(value) }
  kill() { this.kills++; if (this.confirmKill) this.exit?.(9); return this.confirmKill }
  onSpawn(listener: () => void) { this.spawn = listener; return () => { this.spawn = undefined } }
  onExit(listener: (code: number) => void) { this.exit = listener; return () => { this.exit = undefined } }
  onMessage(listener: (value: unknown) => void) { this.message = listener; return () => { this.message = undefined } }
  send(type: 'started' | 'settled') {
    this.message?.({ type, ...request, protocol_version: agentRuntimeProtocolVersion, outcome: 'completed' })
  }
}

function fixture(ticketGate = Promise.resolve()) {
  const process = new StartupProcess()
  const failures: AgentRuntimeFailureCategory[] = []
  const statuses: AgentRuntimeWorkerStatus[] = []
  const logs: Record<string, unknown>[] = []
  let exited = 0
  let tickets = 0
  let tail = Promise.resolve()
  const worker = new AgentRunWorker({
    process, request, executionID: 'age_startup', sessionID: 'ags_startup', coreInstanceID: 'core-1',
    coreBaseURL: 'http://127.0.0.1:8122', supervisorInstanceID: 'supervisor-1', skills: testAgentSkillBundle(),
    core: { issueRuntimeTicket: async () => {
      tickets++
      await ticketGate
      return { ...request, core_instance_id: 'core-1', ticket: 't'.repeat(48), expires_at: '2030-01-01T00:00:00Z' }
    } },
    enqueue: <T>(operation: () => Promise<T>) => {
      const pending = tail.then(operation)
      tail = pending.then(() => undefined)
      return pending
    },
    logger: { info: () => undefined, error: (event, details) => logs.push({ event, ...details }) },
    reportFailure: async (category) => { failures.push(category) },
    publish: (status) => statuses.push(status), onExited: () => { exited++ },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    abortGraceMs: 5, killWaitMs: 5, settledExitGraceMs: 5, steerAckTimeoutMs: 5,
  })
  worker.observe()
  return { worker, process, failures, statuses, logs, exited: () => exited, tickets: () => tickets }
}

test('无 spawn 时报告启动失败，确认退出后才释放，迟到事件不能重启', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  const lateSpawn = f.process.spawn!
  t.mock.timers.tick(10_000)
  assert.equal(f.worker.isStopping(), true)
  lateSpawn()
  await setImmediate()
  assert.deepEqual(f.failures, ['launch_failed'])
  assert.equal(f.process.kills, 1)
  assert.equal(f.exited(), 1)
  assert.equal(f.tickets(), 0)
  assert.equal(f.logs[0].error_code, 'AGENT_RUNTIME_WORKER_SPAWN_TIMEOUT')
})

test('启动完成截止时间不被重复 spawn 延长，未退出的进程仍占用名额', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.process.confirmKill = false
  f.process.spawn!()
  await setImmediate()
  t.mock.timers.tick(119_999)
  f.process.spawn!()
  t.mock.timers.tick(1)
  await setImmediate()
  t.mock.timers.tick(5)
  await setImmediate()
  assert.deepEqual(f.failures, ['launch_failed'])
  assert.equal(f.tickets(), 1)
  assert.equal(f.exited(), 0)
  assert.equal(f.logs[0].stage, 'bootstrap')
  assert.equal(f.statuses[f.statuses.length - 1]?.error_code, 'AGENT_RUNTIME_WORKER_TERMINATION_TIMEOUT')
  f.process.send('started')
  await setImmediate()
  assert.equal(f.statuses.some((status) => status.state === 'running'), false)
  f.process.exit!(9)
  await setImmediate()
  assert.equal(f.exited(), 1)
  assert.equal(f.failures.length, 1)
})

test('Ticket 等待期间超时，迟到凭据不能发送给 Worker', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolve!: () => void
  const f = fixture(new Promise<void>((done) => { resolve = done }))
  f.process.spawn!()
  await setImmediate()
  t.mock.timers.tick(120_000)
  assert.equal(f.worker.isStopping(), true)
  resolve()
  await setImmediate()
  assert.deepEqual(f.process.messages, [])
  assert.deepEqual(f.failures, ['launch_failed'])
  assert.equal(f.exited(), 1)
})

test('started 后只约束业务生命周期，不以启动期限中止正常推理', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.process.spawn!()
  await setImmediate()
  f.process.send('started')
  t.mock.timers.tick(1_000_000)
  await setImmediate()
  assert.equal(f.statuses[f.statuses.length - 1]?.state, 'running')
  assert.deepEqual(f.failures, [])
  assert.equal(f.process.kills, 0)
  f.process.send('settled')
  f.process.exit!(0)
  await setImmediate()
  assert.equal(f.exited(), 1)
})

test('停止、提前终态和退出均取消启动期限，其他代次消息不能取消期限', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const action of ['stop', 'settled', 'exit'] as const) {
    const f = fixture()
    if (action === 'stop') f.worker.requestStop()
    else if (action === 'settled') f.process.send('settled')
    else f.process.exit!(1)
    t.mock.timers.tick(130_000)
    await setImmediate()
    assert.equal(f.logs.some((log) => log.event === 'agent-worker-startup-timeout'), false, action)
  }
  const f = fixture()
  f.process.message!({ type: 'started', protocol_version: agentRuntimeProtocolVersion, ...request, generation: 2 })
  t.mock.timers.tick(10_000)
  await setImmediate()
  assert.deepEqual(f.failures, ['launch_failed'])
})
