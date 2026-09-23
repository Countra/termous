import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMountEvent, isMountActive } from './mount.ts'

test('失败但仍占用资源的挂载不可当作已停止', () => {
  const item = { id: 'run', name: 'test', state: 'failed', mounted: false, retained: true, dirty_nodes: 2, open_handles: 0 }
  const values = decodeMountEvent({ type: 'snapshot', instances: [item] })
  assert.equal(isMountActive(values[0]), true)
  assert.throws(() => decodeMountEvent({ type: 'snapshot', instances: [{ ...item, mounted: 'false' }] }))
})
