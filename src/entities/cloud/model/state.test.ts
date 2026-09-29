import assert from 'node:assert/strict'
import test from 'node:test'
import type { CloudStatus } from '#common/contracts'
import { CloudState } from './state.ts'
import { decodeCloudStatus, decodeCloudEvent } from './decode.ts'

const status: CloudStatus = { generation: 'a', revision: 1, configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }

test('云状态拒绝迟到 HTTP、旧账号事件和倒退版本', () => {
  const store = new CloudState()
  store.accept(status)
  const old = store.epoch
  assert.equal(store.accept({ ...status, generation: 'b', revision: 2, authenticated: true }), true)
  assert.equal(store.accept({ ...status, revision: 99 }, old), false)
  assert.equal(store.accept({ ...status, revision: 99 }), false)
  assert.equal(store.accept({ ...status, generation: 'b', revision: 1 }), false)
  assert.equal(store.snapshot()?.generation, 'b')
  assert.equal(store.accept({ ...status, generation: 'b', revision: 3 }), true)
})

test('云合同解码拒绝非法水位和运行状态', () => {
  assert.equal(decodeCloudStatus(status).revision, 1)
  for (const patch of [{ revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { confirmed: 'yes' }, { phase: 'unknown' }, { pending: null }]) {
    assert.throws(() => decodeCloudStatus({ ...status, ...patch }))
  }
  assert.throws(() => decodeCloudEvent({ type: 'datasets', status, datasets: [null] }))
})
