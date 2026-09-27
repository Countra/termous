import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMountEvent, isMountActive, isMountBusy } from './mount.ts'

test('失败但仍占用资源的挂载不可当作已停止', () => {
  const item = { id: 'run', name: 'test', state: 'failed', mounted: false, retained: true, dirty_nodes: 2, open_handles: 0 }
  const values = decodeMountEvent({ type: 'snapshot', instances: [item] })
  assert.equal(isMountActive(values[0]), true)
  assert.throws(() => decodeMountEvent({ type: 'snapshot', instances: [{ ...item, mounted: 'false' }] }))
})

test('重启及关闭收尾期间仍占用实例，完成后才退出活动列表', () => {
  const base = { id: 'run', name: 'test', state: 'failed', mounted: false, retained: false, dirty_nodes: 0, open_handles: 0 }
  for (const phase of ['restarting', 'unmounting']) {
    const [item] = decodeMountEvent({ type: 'snapshot', instances: [{ ...base, phase }] })
    assert.equal(isMountActive(item), true)
    assert.equal(isMountBusy(item), true)
  }
  for (const state of ['failed', 'stopped']) {
    const [item] = decodeMountEvent({ type: 'snapshot', instances: [{ ...base, state, phase: state }] })
    assert.equal(isMountActive(item), false)
    assert.equal(isMountBusy(item), false)
  }
})
