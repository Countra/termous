import assert from 'node:assert/strict'
import test from 'node:test'
import type { ShortcutDetails } from 'electron'
import { desktopIdentity } from '#common/desktop-identity'
import { prepareWindowsNotificationShortcut } from './windowsNotifications.ts'
import { legacyAppId, migrateWindowsLoginItem, retireLegacyNotificationRegistration, type RegistryValue, type IdentityMigrationAccess } from './windowsMigration.ts'

test('通知初始化前修正快捷方式随机 CLSID，匹配后不重复写入', () => {
  const identity = desktopIdentity('production')
  const exe = 'C:\\Termous\\Termous.exe'
  let shortcut: ShortcutDetails = { target: exe, appUserModelId: legacyAppId, toastActivatorClsid: 'old' }
  let writes = 0
  const access = { exists: () => true, read: () => shortcut, mkdir() {}, write: (_file: string, _operation: string, value: ShortcutDetails) => { shortcut = value; writes++; return true } }
  prepareWindowsNotificationShortcut(identity, exe, 'C:\\Programs', access)
  assert.equal(shortcut.toastActivatorClsid, identity.toastClsid)
  prepareWindowsNotificationShortcut(identity, exe, 'C:\\Programs', access)
  assert.equal(writes, 1)
  shortcut = { ...shortcut, target: 'C:\\Old Termous\\Termous.exe' }
  prepareWindowsNotificationShortcut(identity, exe, 'C:\\Programs', access)
  assert.equal(shortcut.target, exe)
  assert.equal(writes, 2)
  shortcut = { target: 'C:\\Other\\other.exe' }
  assert.throws(() => prepareWindowsNotificationShortcut(identity, exe, 'C:\\Programs', access), /conflict/)
})

function registryFixture() {
  const values = new Map<string, RegistryValue>()
  const actions: string[] = []
  const registry: IdentityMigrationAccess = {
    async read(key, name) { return values.get(`${key}|${name}`) ?? null },
    async write(key, name, value) { actions.push(`write:${key}|${name}`); values.set(`${key}|${name}`, value) },
    async removeValue(key, name) { actions.push(`remove:${key}|${name}`); values.delete(`${key}|${name}`) },
    async removeKey(key) { actions.push(`delete:${key}`) },
  }
  return { values, actions, registry }
}

test('迁移启动项保留系统禁用状态，先写禁用标记，且重复执行无变更', async () => {
  const f = registryFixture()
  const run = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const approved = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  f.values.set(`${run}|${legacyAppId}`, { type: 'REG_SZ', data: '"C:\\Termous\\Termous.exe"' })
  f.values.set(`${approved}|${legacyAppId}`, { type: 'REG_BINARY', data: '030000000000000000000000' })
  await migrateWindowsLoginItem(f.registry, 'C:\\Termous\\Termous.exe', 'com.termous.app')
  assert.match(f.actions[0], /StartupApproved/)
  assert.equal(f.values.get(`${approved}|com.termous.app`)?.data, '030000000000000000000000')
  const count = f.actions.length
  await migrateWindowsLoginItem(f.registry, 'C:\\Termous\\Termous.exe', 'com.termous.app')
  assert.equal(f.actions.length, count)
})

test('读取禁用状态失败时不创建新启动项，遗留通知只清理目标一致的 CLSID', async () => {
  const f = registryFixture()
  const exe = 'C:\\Termous\\Termous.exe'
  f.registry.read = async key => { if (key.endsWith('StartupApproved\\Run')) throw new Error('denied'); return key.endsWith('\\Run') ? { type: 'REG_SZ', data: exe } : null }
  await assert.rejects(migrateWindowsLoginItem({ ...f.registry, read: async (key, name) => name === 'com.termous.app' ? null : f.registry.read(key, name) }, exe, 'com.termous.app'))
  assert.deepEqual(f.actions, [])
  const shortcut = { target: exe, appUserModelId: legacyAppId, toastActivatorClsid: '11111111-1111-1111-1111-111111111111' }
  f.registry.read = async () => ({ type: 'REG_SZ', data: 'C:\\Other\\other.exe' })
  assert.equal(await retireLegacyNotificationRegistration(f.registry, shortcut, [exe]), false)
  f.registry.read = async () => ({ type: 'REG_SZ', data: exe })
  assert.equal(await retireLegacyNotificationRegistration(f.registry, shortcut, [exe]), true)
  assert.equal(f.actions.length, 1)
  assert.equal(await retireLegacyNotificationRegistration(f.registry, { ...shortcut, target: 'other.exe' }, [exe]), false)
})
