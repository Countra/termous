import assert from 'node:assert/strict'
import test from 'node:test'
import type { SettingsSnapshot } from '#common/contracts'
import type { SettingsGateway } from '#entities/settings'
import { SettingsModuleStore, type SettingsTransport } from '../../../entities/settings/model/moduleState.ts'
import { ExtensionPreferences } from './extensionPreferences.ts'

const snapshot = (revision = 1, value = { mode: 'searxng', base_url: 'http://first.test' }): SettingsSnapshot => ({
  id: 'web_search', schema_version: 1, revision, value, state: { status: 'saved' },
})
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
function fixture(update: SettingsTransport['update'], read: SettingsTransport['read'] = async () => snapshot()) {
  const store = new SettingsModuleStore({ read, update })
  store.merge(snapshot())
  const gateway: SettingsGateway = {
    getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe,
  }
  const editor = new ExtensionPreferences(gateway, 'web_search')
  const unsubscribe = editor.subscribe(() => {})
  return { store, editor, unsubscribe }
}

test('编辑不立即发请求，提交只发送变化字段并串行保存最新修改', async () => {
  const first = deferred<SettingsSnapshot>()
  const calls: { revision: number; patch: Record<string, unknown> }[] = []
  const { editor } = fixture(async (_id, request) => {
    calls.push({ revision: request.expected_revision, patch: request.patch })
    return calls.length === 1 ? first.promise : snapshot(3, { mode: 'searxng', base_url: 'http://third.test' })
  })
  editor.change({ base_url: 'http://second.test' })
  assert.equal(editor.snapshot().status, 'editing')
  assert.equal(calls.length, 0)
  editor.commit()
  await settle()
  editor.change({ base_url: 'http://third.test' })
  editor.commit()
  first.resolve(snapshot(2, { mode: 'searxng', base_url: 'http://second.test' }))
  await settle()
  assert.deepEqual(calls, [
    { revision: 1, patch: { base_url: 'http://second.test' } },
    { revision: 2, patch: { base_url: 'http://third.test' } },
  ])
  assert.equal(editor.snapshot().status, 'saved')
  assert.equal(editor.snapshot().value?.base_url, 'http://third.test')
})

test('保存期间继续编辑但未提交的内容保留，不被旧回执覆盖', async () => {
  const pending = deferred<SettingsSnapshot>()
  const { editor } = fixture(() => pending.promise)
  editor.change({ base_url: 'http://second.test' }); editor.commit()
  await settle()
  editor.change({ base_url: 'http://third.test' })
  pending.resolve(snapshot(2, { mode: 'searxng', base_url: 'http://second.test' }))
  await settle()
  assert.equal(editor.snapshot().status, 'editing')
  assert.equal(editor.snapshot().value?.base_url, 'http://third.test')
})

test('排队配置在前次提交完成时仍需完整，清空的地址只保留为草稿', async () => {
  const pending = deferred<SettingsSnapshot>()
  let writes = 0
  const { editor } = fixture(() => { writes++; return pending.promise })
  editor.change({ base_url: 'http://second.test' }); editor.commit()
  await settle()
  editor.change({ base_url: 'http://third.test' }); editor.commit()
  editor.change({ base_url: '' })
  pending.resolve(snapshot(2, { mode: 'searxng', base_url: 'http://second.test' }))
  await settle()
  assert.equal(writes, 1)
  assert.equal(editor.snapshot().status, 'editing')
  assert.equal(editor.snapshot().value?.base_url, '')
  editor.commit()
  await settle()
  assert.equal(writes, 1)
})

test('离开页面后已提交修改继续完成，再次订阅读取保存结果', async () => {
  const pending = deferred<SettingsSnapshot>()
  const { editor, unsubscribe } = fixture(() => pending.promise)
  editor.change({ mode: 'cloud' }); editor.commit()
  await settle()
  unsubscribe()
  pending.resolve(snapshot(2, { mode: 'cloud', base_url: 'http://first.test' }))
  await settle()
  const leave = editor.subscribe(() => {})
  assert.equal(editor.snapshot().status, 'saved')
  assert.equal(editor.snapshot().value?.mode, 'cloud')
  leave()
})

test('冲突保留草稿且不自动重试，明确重试合并外部未编辑字段', async () => {
  let writes = 0
  const calls: { revision: number; patch: Record<string, unknown> }[] = []
  const { editor } = fixture(async (_id, request) => {
    calls.push({ revision: request.expected_revision, patch: request.patch })
    if (++writes === 1) throw new Error('SETTINGS_REVISION_CONFLICT')
    return snapshot(5, { mode: 'cloud', base_url: String(request.patch.base_url) })
  }, async () => snapshot(4, { mode: 'cloud', base_url: 'http://external.test' }))
  editor.change({ base_url: 'http://edited.test' }); editor.commit()
  await settle()
  assert.equal(writes, 1)
  assert.equal(editor.snapshot().status, 'failed')
  assert.equal(editor.snapshot().value?.base_url, 'http://edited.test')
  editor.retry()
  await settle()
  assert.deepEqual(calls[1], { revision: 4, patch: { base_url: 'http://edited.test' } })
  assert.deepEqual(editor.snapshot().value, { mode: 'cloud', base_url: 'http://edited.test' })
})

test('网络错误保留最新草稿，恢复已保存值不会自动重放', async () => {
  const pending = deferred<SettingsSnapshot>()
  let writes = 0
  const { editor } = fixture(() => { writes++; return pending.promise })
  editor.change({ base_url: 'http://second.test' }); editor.commit()
  await settle()
  editor.change({ base_url: 'http://third.test' }); editor.commit()
  pending.reject(new Error('network unavailable'))
  await settle()
  assert.equal(writes, 1)
  assert.equal(editor.snapshot().error, 'network unavailable')
  assert.equal(editor.snapshot().value?.base_url, 'http://third.test')
  editor.reset()
  assert.equal(editor.snapshot().value?.base_url, 'http://first.test')
  assert.equal(editor.snapshot().error, undefined)
})

test('实例重置丢弃旧请求回执和排队修改，不污染新实例', async () => {
  const pending = deferred<SettingsSnapshot>()
  const { editor, store } = fixture(() => pending.promise)
  editor.change({ base_url: 'http://second.test' }); editor.commit()
  await settle()
  editor.change({ mode: 'cloud' }); editor.commit()
  store.reset()
  store.merge(snapshot(1, { mode: 'cloud', base_url: 'http://new-instance.test' }))
  pending.resolve(snapshot(99))
  await settle()
  assert.equal(editor.snapshot().status, 'idle')
  assert.equal(editor.snapshot().value?.base_url, 'http://new-instance.test')
  assert.equal(store.snapshot('web_search')?.revision, 1)
})
