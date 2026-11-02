import assert from 'node:assert/strict'
import test from 'node:test'
import { assetIndex, importAssets, validPath } from './resources.ts'

test('路径合同支持中文和 PNG 大写后缀，拒绝跨平台非法名称', () => {
  for (const path of ['assets/登录按钮.png', 'assets/a b.PNG', 'assets/é.png', 'assets/image_001.png']) assert.equal(validPath(path), true, path)
  for (const path of ['../a.png', 'assets/../a.png', 'assets/sub/a.png', 'assets\\a.png', 'assets/.a.png', 'assets/ a.png', 'assets/a.png ', 'assets/COM1.png', 'assets/NUL.other.png', 'assets/LPT¹.png', 'assets/a:stream.png', 'assets/a\n.png', 'assets/a\u200b.png', `assets/${'中'.repeat(42)}.png`]) assert.equal(validPath(path), false, path)
})

test('清单覆盖禁用分支与拖动目标，拒绝缺失、多余及旧格式', () => {
  const fixture = (paths: string[]) => ({ format: 'termous.desktop-workflow', format_version: 1,
    assets: paths.map(path => ({ path })), definition: { steps: [{ disabled: true, image: { path: 'assets/a.png' }, else: [{ end_target: { image: { path: 'assets/é.png' } } }] }] } })
  const paths = ['assets/a.png', 'assets/é.png']
  assert.deepEqual(importAssets(fixture(paths)), paths.map(path => ({ path })))
  for (const values of [paths.slice(0, 1), [...paths, 'assets/unused.png'], [...paths, 'assets/A.png'], [...paths, 'assets/e\u0301.png']]) assert.throws(() => importAssets(fixture(values)))
  assert.throws(() => importAssets({ ...fixture(paths), assets: [{ sha256: 'old' }] }), (error: unknown) => {
    assert.equal((error as { details: { diagnostics: { code: string }[] } }).details.diagnostics[0].code, 'exchange_format_legacy')
    return true
  })
})

test('实测索引允许同内容多路径，但不允许同路径或大小写冲突', () => {
  const asset = { path: 'assets/a.png', sha256: 'a'.repeat(64), size: 20, width: 16, height: 16 }
  assert.equal(assetIndex({ assets: [asset, { ...asset, path: 'assets/b.png' }] }).length, 2)
  assert.throws(() => assetIndex({ assets: [asset, { ...asset, path: 'assets/A.png' }] }))
})
