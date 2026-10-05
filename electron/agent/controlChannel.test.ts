import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { AgentControlChannel } from './controlChannel.ts'
import type { AgentCoreRuntimePort, AgentSupervisorLease } from './coreRuntimeClient.ts'
import type { AgentControlCommand } from './controlProtocol.ts'

const lease: AgentSupervisorLease = { core_instance_id: 'core', supervisor_instance_id: 'supervisor', runtime_protocol_version: '10', revision: 1, expires_at: new Date(Date.now() + 30000).toISOString() }

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
