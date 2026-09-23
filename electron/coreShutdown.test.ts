import assert from 'node:assert/strict'
import test from 'node:test'
import { awaitCoreShutdown, type ShutdownDependencies } from './coreShutdown.ts'

function fixture(overrides: Partial<ShutdownDependencies> = {}) {
  let now = 0
  let committed = 0
  return {
    dependencies: {
      request: async () => true,
      probe: async () => null,
      exited: () => false,
      now: () => now,
      wait: async (ms: number) => { now += ms },
      committed: () => { committed += 1 },
      ...overrides,
    },
    committed: () => committed,
  }
}

test('准备退出超过八秒仍等待，提交后才停止心跳', async () => {
  let probes = 0
  const value = fixture({
    probe: async () => ({ shutdown_phase: ++probes < 80 ? 'preparing' : 'closing' }),
    exited: () => probes > 80,
  })
  assert.deepEqual(await awaitCoreShutdown(value.dependencies), { status: 'stopped' })
  assert.ok(probes > 40)
  assert.ok(value.committed() > 0)
})

test('写回失败返回原因并保留心跳和进程', async () => {
  const value = fixture({ probe: async () => ({ shutdown_phase: 'blocked', shutdown_error: 'quota' }) })
  assert.deepEqual(await awaitCoreShutdown(value.dependencies), { status: 'blocked', message: 'quota' })
  assert.equal(value.committed(), 0)
})

test('轮询超时不表示进程已经退出，也不接受其他进程状态', async () => {
  const value = fixture({ expectedPID: 3, probe: async () => ({ pid: 4, shutdown_phase: 'closed' }) })
  assert.equal((await awaitCoreShutdown(value.dependencies, 1000)).status, 'failed')
  assert.equal(value.committed(), 0)
})
