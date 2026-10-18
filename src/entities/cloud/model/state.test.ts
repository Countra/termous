import assert from 'node:assert/strict'
import test from 'node:test'
import type { CloudStatus, CloudAccountChange } from '#common/contracts'
import { CloudState } from './state.ts'
import { decodeCloudStatus, decodeCloudEvent } from './decode.ts'
import { decodeCloudProfile, decodeCloudDevice } from './decode.ts'

const status: CloudStatus = { generation: 'a', revision: 1, configured: true, authenticated: false, phase: 'signed_out', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }

test('设备名称版本兼容旧只读响应，拒绝负数、溢出和非规范版本', () => {
  const device = { id: 'device', user_id: 'owner', name: '我的电脑', signing_key: 'public', recipient: 'public', status: 'active', created_at: '2026-10-08T00:00:00Z' }
  assert.equal(decodeCloudDevice(device).name_revision, undefined)
  assert.equal(decodeCloudDevice({ ...device, name_revision: '0' }).name_revision, '0')
  for (const revision of [null, 1, '-1', '01', '', '9223372036854775808']) {
    assert.throws(() => decodeCloudDevice({ ...device, name_revision: revision }))
  }
})

test('个人资料拒绝外部头像地址与非法版本', () => {
  const profile = { user_id: 'synthetic', name: '', bio: '', organization: '', avatar: '', revision: '0', updated_at: null }
  assert.equal(decodeCloudProfile(profile).revision, '0')
  for (const patch of [{ avatar: 'https://example.test/avatar.png' }, { avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }, { revision: 1 }, { revision: '-1' }, { revision: '9223372036854775808' }, { updated_at: 'invalid' }]) {
    assert.throws(() => decodeCloudProfile({ ...profile, ...patch }))
  }
})

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

test('账号变化局部失效，即使 HTTP 状态较新也不遗漏；切换账号后拒绝旧提示', () => {
  const store = new CloudState(), changes: CloudAccountChange[] = []
  const unsubscribe = store.subscribeChanges(change => changes.push(change))
  store.accept({ ...status, revision: 10 })
  store.acceptEvent({ type: 'account', status, changes: ['profile'], operations: [] })
  assert.deepEqual(changes[0]?.changes, ['profile'])
  store.acceptEvent({ type: 'snapshot', status: { ...status, generation: 'b' } })
  assert.ok(changes[1]?.changes.includes('devices'))
  store.acceptEvent({ type: 'account', status: { ...status, revision: 99 }, changes: ['mfa'] })
  assert.equal(changes.length, 2)
  unsubscribe()
  store.acceptEvent({ type: 'resync', status: { ...status, generation: 'b' } })
  assert.equal(changes.length, 2)
})

test('账号提示不允许任意失效类别或非法操作标识', () => {
  assert.deepEqual(decodeCloudEvent({ type: 'account', status, changes: ['profile'], operations: ['request_test'] }).changes, ['profile'])
  assert.throws(() => decodeCloudEvent({ type: 'account', status, changes: ['execute'] }))
  assert.throws(() => decodeCloudEvent({ type: 'account', status, changes: ['profile'], operations: [null] }))
})
