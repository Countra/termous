import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { NotificationPreferencesStore } from './preferences.ts'

test('通知偏好严格校验、串行原子保存并在重启恢复', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'termous-notifications-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'preferences.json')
  let warnings = 0
  const store = new NotificationPreferencesStore(file, () => { warnings++ })
  await store.load()
  assert.equal(warnings, 0)
  assert.deepEqual(store.get(), { enabled: true, agent: true, file: true, approval: true })
  assert.throws(() => store.set({ enabled: 'yes', agent: true, file: true }))
  assert.throws(() => store.set({ enabled: true, agent: true, file: true, url: 'not-allowed' }))
  await Promise.all([store.set({ enabled: false, agent: true, file: true }), store.set({ enabled: true, agent: false, file: false })])
  const restored = new NotificationPreferencesStore(file, () => { warnings++ })
  await restored.load()
  assert.deepEqual(restored.get(), store.get())
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schema_version, 1)
  await writeFile(file, JSON.stringify({ schema_version: 1, preferences: { enabled: false, agent: false, file: true } }))
  await restored.load()
  assert.deepEqual(restored.get(), { enabled: false, agent: false, file: true, approval: true })
  await writeFile(file, '{broken')
  await restored.load()
  assert.equal(warnings, 1)
})
