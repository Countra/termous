import assert from 'node:assert/strict'
import test from 'node:test'
import { shutdownAgentServices } from './shutdown.ts'

test('先等待 Worker 完成退出，再关闭扩展宿主', async () => {
  const order: string[] = []
  let finish!: () => void
  const stopped = new Promise<void>(resolve => { finish = resolve })
  const pending = shutdownAgentServices({ shutdown: async () => { order.push('workers'); await stopped; order.push('stopped') } },
    { close: async () => { order.push('integrations') } })
  assert.deepEqual(order, ['workers'])
  finish()
  await pending
  assert.deepEqual(order, ['workers', 'stopped', 'integrations'])
})

for (const failures of [[true, false], [false, true], [true, true]]) {
  test(`关闭失败仍完成双方清理并保留错误：${failures.join(',')}`, async () => {
    const order: string[] = []
    const errors = [new Error('worker failed'), new Error('host failed')]
    await assert.rejects(shutdownAgentServices({ shutdown: async () => { order.push('workers'); if (failures[0]) throw errors[0] } },
      { close: async () => { order.push('integrations'); if (failures[1]) throw errors[1] } }), error => {
      assert.ok(error instanceof Error && 'causes' in error)
      assert.deepEqual(error.causes, errors.filter((_, i) => failures[i]))
      return true
    })
    assert.deepEqual(order, ['workers', 'integrations'])
  })
}
