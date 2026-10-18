import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SystemClipboardConnectionState } from '#common/contracts'
import { SystemClipboardStore } from './store.ts'
import { selectSystemClipboardOperation } from './selectors.ts'

function snapshot(version = 1, instance = 'core'): SystemClipboardConnectionState {
  return { version, status: 'connected', snapshot: { schema_version: 1, instance_id: instance, revision: 1, capabilities: {
    import_files: { state: 'ready' }, publish_files: { state: 'unsupported', reason: 'platform_unsupported' },
  } } }
}

test('未确认和无本机桥接均隐藏；单方向能力独立展示', async () => {
  const store = new SystemClipboardStore()
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').visible, false)
  const dispose = store.connect({ get: async () => snapshot(), subscribe: () => () => {} })
  await Promise.resolve()
  assert.deepEqual(selectSystemClipboardOperation(store.get(), 'import_files'), { visible: true, available: true, reason: undefined })
  assert.equal(selectSystemClipboardOperation(store.get(), 'publish_files').visible, false)
  dispose()
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').visible, true)
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').available, false)
  store.connect()
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').visible, false)
})

test('事件先到时丢弃旧查询；断线保留支持，恢复实例后拒绝旧代次', async () => {
  const store = new SystemClipboardStore()
  let listener!: (value: SystemClipboardConnectionState) => void
  let finish!: (value: SystemClipboardConnectionState) => void
  let unsubscribed = false
  const dispose = store.connect({ get: () => new Promise(resolve => { finish = resolve }), subscribe: callback => { listener = callback; return () => { unsubscribed = true } } })
  listener(snapshot(2))
  listener({ ...snapshot(3), status: 'disconnected' })
  finish(snapshot(1))
  await Promise.resolve()
  assert.equal(store.get().status, 'disconnected')
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').visible, true)
  listener(snapshot(4, 'restarted'))
  assert.equal(store.get().snapshot?.instance_id, 'restarted')
  listener(snapshot(2))
  assert.equal(store.get().snapshot?.instance_id, 'restarted')
  dispose()
  assert.equal(unsubscribed, true)
  const current = store.get()
  listener(snapshot(100))
  assert.equal(store.get(), current)
})

test('初始化失败保持支持并禁用；查询失败不能变成平台不支持', async () => {
  const store = new SystemClipboardStore()
  const unavailable = snapshot()
  unavailable.snapshot!.capabilities.import_files = { state: 'unavailable', reason: 'initialization_failed' }
  store.connect({ get: async () => unavailable, subscribe: () => () => {} })
  await Promise.resolve()
  assert.deepEqual(selectSystemClipboardOperation(store.get(), 'import_files'), { visible: true, available: false, reason: 'initialization_failed' })
  store.connect({ get: async () => { throw new Error('404') }, subscribe: () => () => {} })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(store.get().status, 'disconnected')
  assert.equal(selectSystemClipboardOperation(store.get(), 'import_files').visible, false)
})
