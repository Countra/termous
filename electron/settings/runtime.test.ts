import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { settingsIPCChannels } from '#common/contracts'
import { DesktopSettingsRuntime, registerSettingsIPC, type DesktopSettingsAdapter } from './runtime.ts'

test('统一 IPC 校验窗口、模块和补丁；不开放任意路径或命令', async () => {
  let writes = 0
  const adapter: DesktopSettingsAdapter = { read: () => ({ value: {}, state: { status: 'applied' } }), apply: () => { writes++ } }
  const runtime = new DesktopSettingsRuntime({ notifications: adapter, updates: adapter, login_item: adapter }, () => {})
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const trusted = {} as IpcMainInvokeEvent
  const dispose = registerSettingsIPC({ runtime, trusted: (event) => event === trusted, ipcMain: {
    handle: (channel, handler) => { handlers.set(channel, handler as (...args: unknown[]) => unknown) }, removeHandler: (channel) => { handlers.delete(channel) },
  } })
  for (const handler of handlers.values()) assert.throws(() => handler({}, 'notifications'), /NOT_ALLOWED/)
  assert.deepEqual(await runtime.request('command', {}), { ok: false, code: 'SETTINGS_UNSUPPORTED_MODULE' })
  assert.deepEqual(await handlers.get(settingsIPCChannels.update)!(trusted, 'updates'), { ok: false, code: 'SETTINGS_INVALID_REQUEST' })
  for (const request of [null, {}, { expected_revision: 1, patch: {}, path: 'x' }, { expected_revision: 0, patch: { enabled: true } }]) {
    assert.deepEqual(await runtime.request('notifications', request), { ok: false, code: 'SETTINGS_INVALID_REQUEST' })
  }
  assert.equal(writes, 0)
  dispose()
  assert.equal(handlers.size, 0)
})

test('并发写入按模块检查版本；失败不发布变更或重放操作', async () => {
  let enabled = true
  let failed = false
  let writes = 0
  const events: unknown[] = []
  const adapter: DesktopSettingsAdapter = { read: () => ({ value: { enabled }, state: { status: 'applied' } }), apply: (patch) => { writes++; if (failed) throw new Error('disk error'); enabled = patch.enabled === true } }
  const runtime = new DesktopSettingsRuntime({ notifications: adapter, updates: adapter, login_item: adapter }, (event) => events.push(event))
  const results = await Promise.all([runtime.request('notifications', { expected_revision: 1, patch: { enabled: false } }), runtime.request('notifications', { expected_revision: 1, patch: { enabled: true } })])
  assert.equal(results[0].ok, true)
  assert.deepEqual(results[1], { ok: false, code: 'SETTINGS_REVISION_CONFLICT' })
  assert.equal(writes, 1)
  assert.equal(events.length, 1)
  failed = true
  assert.deepEqual(await runtime.request('notifications', { expected_revision: 2, patch: { enabled: true } }), { ok: false, code: 'SETTINGS_OPERATION_FAILED' })
  assert.equal(events.length, 1)
  const current = await runtime.request('notifications')
  assert.ok(current.ok)
  assert.equal(current.snapshot.value.enabled, false)
})
