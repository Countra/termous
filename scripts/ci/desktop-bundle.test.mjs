import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createCanonicalTempDirectory } from '../test-support/temp-directory.ts'
import { validateDesktopBundle } from './desktop-bundle.mjs'

const version = '1.2.3'

async function fixture(t) {
  const directory = await createCanonicalTempDirectory('desktop-bundle-')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sha256 = {}
  for (const name of ['termous-core.exe', 'termous-desktop.exe', 'termous-desktopd.exe']) {
    await writeFile(path.join(directory, name), `fixture:${name}`)
    sha256[name] = createHash('sha256').update(`fixture:${name}`).digest('hex')
  }
  await writeFile(path.join(directory, 'desktop-bundle.json'), JSON.stringify({ protocol_version: 3, auth_key_id: 'termous-desktop-v1', build_version: version, sha256 }))
  return directory
}

test('完整配套产物通过流式摘要校验', async t => {
  await validateDesktopBundle(await fixture(t), version)
})

for (const [name, change] of [
  ['空对象', () => ({})],
  ['错误协议', b => ({ ...b, protocol_version: 1 })],
  ['错误密钥编号', b => ({ ...b, auth_key_id: 'unknown' })],
  ['错误构建版本', b => ({ ...b, build_version: 'development' })],
  ['额外顶层字段', b => ({ ...b, other: true })],
  ['缺失摘要', b => { delete b.sha256['termous-desktopd.exe']; return b }],
  ['额外程序', b => { b.sha256['other.exe'] = '0'.repeat(64); return b }],
  ['摘要格式错误', b => { b.sha256['termous-core.exe'] = 'invalid'; return b }],
  ['摘要错误', b => { b.sha256['termous-core.exe'] = '0'.repeat(64); return b }],
]) {
  test(`拒绝${name}`, async t => {
    const directory = await fixture(t)
    const manifest = path.join(directory, 'desktop-bundle.json')
    const bundle = JSON.parse(await readFile(manifest, 'utf8'))
    await writeFile(manifest, JSON.stringify(change(bundle)))
    await assert.rejects(validateDesktopBundle(directory, version), /桌面组件/)
  })
}

test('拒绝缺失程序与被单独替换的程序', async t => {
  const directory = await fixture(t)
  const binary = path.join(directory, 'termous-desktop.exe')
  await rm(binary)
  await assert.rejects(validateDesktopBundle(directory, version), { code: 'ENOENT' })
  await writeFile(binary, 'different-build')
  await assert.rejects(validateDesktopBundle(directory, version), /摘要不匹配/)
})

test('拒绝空、损坏和超大清单', async t => {
  const directory = await fixture(t)
  for (const content of ['', '{', ' '.repeat(65537)]) {
    await writeFile(path.join(directory, 'desktop-bundle.json'), content)
    await assert.rejects(validateDesktopBundle(directory, version), /桌面组件/)
  }
})

test('独立载荷检查应用 Core 与服务目录的完整配套', async t => {
  const service = await fixture(t)
  const application = path.join(service, 'application')
  await mkdir(application)
  await rename(path.join(service, 'termous-core.exe'), path.join(application, 'termous-core.exe'))
  await validateDesktopBundle(service, version, application)
  await writeFile(path.join(application, 'termous-core.exe'), 'different-build')
  await assert.rejects(validateDesktopBundle(service, version, application), /摘要不匹配/)
})
