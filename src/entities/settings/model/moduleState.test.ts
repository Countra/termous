import assert from 'node:assert/strict'
import test from 'node:test'
import type { SettingsModuleId, SettingsSnapshot } from '../../../../common/contracts/settings-center.ts'
import { SettingsModuleStore, decodeSettingsCatalogue, decodeSettingsSnapshot } from './moduleState.ts'

const snapshot = (id: SettingsModuleId, revision = 1, value = { enabled: true }): SettingsSnapshot => ({ id, schema_version: 1, revision, value, state: { status: 'applied' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

test('同模块串行提交使用最新版本，不同模块独立推进', async () => {
  const first = deferred<SettingsSnapshot>()
  const calls: { id: string; revision: number }[] = []
  const store = new SettingsModuleStore({ read: async (id) => snapshot(id), update: async (id, body) => {
    calls.push({ id, revision: body.expected_revision })
    return id === 'appearance' && body.expected_revision === 1 ? first.promise : snapshot(id, body.expected_revision + 1)
  } })
  const a = store.update('appearance', { enabled: false })
  const b = store.update('appearance', { enabled: true })
  const c = store.update('connection', { enabled: false })
  await c
  assert.deepEqual(calls, [{ id: 'appearance', revision: 1 }, { id: 'connection', revision: 1 }])
  first.resolve(snapshot('appearance', 2))
  await Promise.all([a, b])
  assert.equal(calls[2].revision, 2)
  assert.equal(store.snapshot('connection')?.revision, 2)
  assert.equal(store.snapshot('appearance')?.revision, 3)
})

test('冲突刷新确认值且保留草稿，排队旧修改不自动重放', async () => {
  let writes = 0
  const store = new SettingsModuleStore({ read: async (id) => snapshot(id, 4), update: async () => {
    writes++
    throw Object.assign(new Error('conflict'), { code: 'SETTINGS_REVISION_CONFLICT' })
  } })
  store.merge(snapshot('mcp', 1))
  const a = store.update('mcp', { enabled: true })
  const b = store.update('mcp', { enabled: false })
  const results = await Promise.allSettled([a, b])
  assert.ok(results.every((result) => result.status === 'rejected'))
  assert.equal(writes, 1)
  assert.equal(store.snapshot('mcp')?.revision, 4)
  assert.deepEqual(store.draft('mcp'), { enabled: false })
})

test('失败和乱序响应不回滚其他模块，切换运行实例丢弃迟到读写', async () => {
  const late = deferred<SettingsSnapshot>()
  const store = new SettingsModuleStore({ read: () => late.promise, update: async () => { throw new Error('failed') } })
  store.merge(snapshot('connection', 3))
  store.merge(snapshot('connection', 2))
  await assert.rejects(store.update('mcp', { enabled: true }, { expectedRevision: 1 }), /failed/)
  assert.equal(store.snapshot('connection')?.revision, 3)
  const old = store.read('audit')
  store.reset()
  store.merge(snapshot('audit', 1, { enabled: false }))
  late.resolve(snapshot('audit', 9))
  await assert.rejects(old, /SUPERSEDED/)
  assert.equal(store.snapshot('audit')?.value.enabled, false)
})

test('合同拒绝未知模块、结构版本和重复目录项', () => {
  assert.throws(() => decodeSettingsSnapshot({ ...snapshot('audit'), schema_version: 2 }), /VERSION/)
  assert.throws(() => decodeSettingsSnapshot({ ...snapshot('audit'), id: 'unknown' }), /MODULE/)
  const entry = { id: 'audit', schema_version: 1, backup: 'exclude', apply: 'immediate', snapshot: snapshot('audit') }
  assert.throws(() => decodeSettingsCatalogue({ instance_id: 'core', modules: [entry, entry] }), /CATALOGUE/)
})

test('桌面桥接仅保留 message 时仍识别冲突并保留草稿', async () => {
  const store = new SettingsModuleStore({
    read: async (id) => snapshot(id, 3),
    update: async () => { throw new Error('SETTINGS_REVISION_CONFLICT') },
  })
  store.merge(snapshot('notifications', 1))
  await assert.rejects(store.update('notifications', { enabled: false }), /REVISION_CONFLICT/)
  assert.equal(store.snapshot('notifications')?.revision, 3)
  assert.deepEqual(store.draft('notifications'), { enabled: false })
})
