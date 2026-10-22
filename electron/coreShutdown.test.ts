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

test('组件写入超过普通退出超时仍等待，完成后才发送关闭请求', async () => {
  let maintenanceCalls = 0
  let requested = false
  const value = fixture({
    maintenance: async () => ++maintenanceCalls < 300,
    request: async () => { assert.ok(maintenanceCalls >= 300); requested = true; return true },
    exited: () => requested,
  })
  assert.deepEqual(await awaitCoreShutdown(value.dependencies, 1000), { status: 'stopped' })
  assert.ok(requested)
})

test('无法确认维护状态时保留应用，不发送关闭请求', async () => {
  const value = fixture({ maintenance: async () => { throw new Error('offline') },
    request: async () => { assert.fail('不应发起关闭') } })
  assert.equal((await awaitCoreShutdown(value.dependencies)).status, 'failed')
})

test('维护查询期间所属 Core 已退出时按成功关闭处理', async () => {
  let exited = false
  const value = fixture({
    maintenance: async () => { exited = true; throw new Error('connection closed') },
    exited: () => exited,
    request: async () => { assert.fail('已退出的 Core 不应再次请求关闭') },
  })
  assert.deepEqual(await awaitCoreShutdown(value.dependencies), { status: 'stopped' })
})
