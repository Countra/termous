import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { AgentControlChannel } from './controlChannel.ts'
import type { AgentCoreRuntimePort, AgentSupervisorLease } from './coreRuntimeClient.ts'
import type { AgentControlCommand } from './controlProtocol.ts'

const lease: AgentSupervisorLease = { core_instance_id: 'core', supervisor_instance_id: 'supervisor', runtime_protocol_version: '12', supervisor_epoch: 1, max_concurrent_runs: 4, revision: 1, expires_at: new Date(Date.now() + 30000).toISOString() }

test('插入回执占满时停止仍可执行，ACK 重试不重新执行命令', async () => {
  const queued: AgentControlCommand[] = [0, 1, 2, 3].map(n => ({ id: `steer_${n}`, action: 'steer', run_id: 'run', generation: 1, message: '测试' }))
  queued.push({ id: 'stop', action: 'stop', run_id: 'run', generation: 1 })
  const executions: string[] = []
  const pending: (() => void)[] = []
  const attempts = new Map<string, number>()
  const core = {
    pollControl: async (_identity, signal) => queued.shift() ?? await new Promise<null>(resolve => signal.addEventListener('abort', () => resolve(null), { once: true })),
    ackControl: async input => {
      const count = (attempts.get(input.id) ?? 0) + 1
      attempts.set(input.id, count)
      if (count === 1) throw new Error('测试回执丢失')
    },
  } satisfies Pick<AgentCoreRuntimePort, 'pollControl' | 'ackControl'>
  const channel = new AgentControlChannel(core, async command => {
    executions.push(command.id)
    if (command.action === 'steer') await new Promise<void>(resolve => pending.push(resolve))
    else for (const resolve of pending) resolve()
    return { accepted: true, status: { state: 'ready' } }
  })
  channel.attach(lease)
  try {
    const until = Date.now() + 3000
    while (attempts.get('stop') !== 2 && Date.now() < until) await pause(10)
    assert.equal(attempts.get('stop'), 2)
    assert.deepEqual(executions, ['steer_0', 'steer_1', 'steer_2', 'steer_3', 'stop'])
  } finally { channel.close() }
})

test('慢会话的插入回执不阻塞其余七个会话或队列唤醒', async () => {
  const queued: AgentControlCommand[] = Array.from({ length: 5 }, (_, n) => ({
    id: `first_${n}`, action: 'steer', run_id: 'first', generation: 1, message: '测试',
  }))
  for (let n = 1; n < 8; n++) queued.push({ id: `other_${n}`, action: 'steer', run_id: `run_${n}`, generation: 1, message: '测试' })
  queued.push({ id: 'wake', action: 'wake' }, { id: 'stop', action: 'stop', run_id: 'first', generation: 1 })
  const executions: string[] = []
  const results = new Map<string, boolean>()
  let releaseHeld = () => {}
  let signalStopped = () => {}
  const held = new Promise<void>(resolve => { releaseHeld = resolve })
  const stopped = new Promise<void>(resolve => { signalStopped = resolve })
  const core = {
    pollControl: async (_identity, signal) => queued.shift() ?? await new Promise<null>(resolve => signal.addEventListener('abort', () => resolve(null), { once: true })),
    ackControl: async input => {
      results.set(input.id, input.accepted)
      if (input.id === 'stop') signalStopped()
    },
  } satisfies Pick<AgentCoreRuntimePort, 'pollControl' | 'ackControl'>
  const channel = new AgentControlChannel(core, async command => {
    executions.push(command.id)
    if (command.action === 'steer') await held
    return { accepted: true, status: { state: 'ready' } }
  })
  channel.attach({ ...lease, max_concurrent_runs: 8 })
  try {
    await stopped
    assert.equal(results.get('first_4'), false)
    assert.deepEqual(executions, ['first_0', 'first_1', 'first_2', 'first_3', ...Array.from({ length: 7 }, (_, n) => `other_${n + 1}`), 'wake', 'stop'])
    assert.equal(results.get('wake'), true)
  } finally {
    releaseHeld()
    channel.close()
  }
})
