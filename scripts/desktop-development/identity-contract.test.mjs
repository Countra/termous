import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './production-builder.mjs'
import identities from '../../common/desktop-identity/identities.json' with { type: 'json' }
import { assertShellStopped, withShellPreparation } from './cache.mjs'
import { shellExecutable } from './prepare.mjs'

test('开发壳按平台和架构定位，macOS 使用应用包内部可执行文件', () => {
  assert.equal(shellExecutable('fixture', 'win32', 'arm64'), path.join('fixture', 'win-arm64-unpacked/Termous Dev.exe'))
  assert.equal(shellExecutable('fixture', 'darwin', 'arm64'), path.join('fixture', 'mac-arm64/Termous Dev.app/Contents/MacOS/Termous Dev'))
  assert.equal(shellExecutable('fixture', 'linux', 'x64'), path.join('fixture', 'linux-unpacked/Termous Dev'))
})

test('正式构建固定旧升级 GUID，身份与 Linux 入口来自单一配置，更新模拟保持隔离', async () => {
  assert.equal(config.appId, identities.production.appId)
  assert.equal(config.nsis.guid, '2d22eb01-e141-5a8b-b280-379650e0df4c')
  assert.equal(config.extraMetadata.desktopName, identities.production.desktopName)
  assert.equal(config.extraMetadata.termousDesktopChannel, 'production')
  assert.equal(config.linux.syncDesktopName, true)
  const simulation = await readFile(new URL('../../electron-builder.update-simulation.json5', import.meta.url), 'utf8')
  assert.match(simulation, /dev\.termous\.update-simulation/)
  assert.doesNotMatch(simulation, /production-builder|2d22eb01/)
  const installer = await readFile(new URL('../../build/installer-options.nsh', import.meta.url), 'utf8')
  assert.doesNotMatch(installer, /StartMenuShortcutCheckbox/)
})

test('开发壳缓存保护存活进程，准备互斥，失败后释放准备锁', async t => {
  const root = fileURLToPath(new URL('../../../TEMP/desktop-identity-tests/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'active.json'), JSON.stringify({ pid: 123 }))
  await assert.rejects(assertShellStopped(directory, () => {}), /正在运行/)
  await assertShellStopped(directory, () => { throw Object.assign(new Error('exited'), { code: 'ESRCH' }) })
  await assert.rejects(withShellPreparation(directory, async () => {
    await assert.rejects(withShellPreparation(directory, async () => {}), /正在准备/)
    throw new Error('fixture')
  }), /fixture/)
  await withShellPreparation(directory, async () => {})
})
