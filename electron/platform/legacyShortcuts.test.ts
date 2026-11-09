import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pendingLegacyShortcuts, migrateLegacyShortcuts } from './legacyShortcuts.ts'
import { legacyAppId, type IdentityMigrationAccess } from './windowsMigration.ts'

test('修复快捷方式前保存迁移材料，注册清理失败可按原归属重试', async t => {
  const root = path.resolve('../TEMP/desktop-migration-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'Termous.lnk')
  const journal = path.join(directory, 'migration.json')
  await writeFile(file, '合成快捷方式')
  const details = { target: 'C:\\Termous\\Termous.exe', appUserModelId: legacyAppId, toastActivatorClsid: '11111111-1111-1111-1111-111111111111' }
  const entries = pendingLegacyShortcuts(directory, journal, () => details)
  let denied = true
  let failures = 0
  const registry: IdentityMigrationAccess = {
    async read() { return { type: 'REG_SZ', data: details.target } },
    async write() {}, async removeValue() {},
    async removeKey() { if (denied) throw new Error('fixture denied') },
  }
  const readCurrent = () => ({ ...details, appUserModelId: 'com.termous.app' })
  await migrateLegacyShortcuts(entries, journal, file, details.target, registry, readCurrent, () => { failures++ })
  assert.equal(failures, 1)
  assert.equal(JSON.parse(await readFile(journal, 'utf8')).length, 1)
  denied = false
  const retry = pendingLegacyShortcuts(directory, journal, readCurrent)
  await migrateLegacyShortcuts(retry, journal, file, details.target, registry, readCurrent, () => { failures++ })
  assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')), [])
  assert.equal(await readFile(file, 'utf8'), '合成快捷方式')
})
