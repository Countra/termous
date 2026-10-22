import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { buildOutputPaths, requireManagedPath } from '../build/output-paths.mjs'
import { preparedAppFiles } from '../build/package-prepared.mjs'
import { createCanonicalTempDirectory, createCanonicalTempDirectorySync } from '../test-support/temp-directory.ts'

test('构建器退出清理不能覆盖打包失败状态', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'data:text/javascript,process.once("beforeExit",()=>process.exit(0))',
    'scripts/build/package-prepared.mjs', 'missing-prepared-layout-fixture.json',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ENOENT/)
})

test('受管输出必须具有归属记录，且拒绝根目录和逃逸路径', async t => {
  const root = await createCanonicalTempDirectory('termous prepared ')
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = path.join(root, 'bin')
  assert.throws(() => requireManagedPath(root, output))
  await writeFile(path.join(root, '.termous-build-root.json'), JSON.stringify({ schema_version: 1, root }))
  await mkdir(output, { recursive: true })
  assert.throws(() => requireManagedPath(root, root), /超出/)
  assert.throws(() => requireManagedPath(root, path.resolve(root, '../foreign')), /超出/)
  const paths = buildOutputPaths('/unused-web', { TERMOUS_BUILD_ROOT: root, TERMOUS_BUILD_OUTPUT_DIR: output })
  assert.equal(paths.electron, path.join(output, 'dist-electron'))
  assert.equal(paths.skills, path.join(output, 'skills'))
  assert.equal(paths.verification, path.join(root, 'work/verify/workers'))
  assert.equal(paths.managed, true)
})

for (const [mode, createDirectory] of [
  ['异步', createCanonicalTempDirectory],
  ['同步', createCanonicalTempDirectorySync],
]) {
  test(`临时根目录存在系统别名时，${mode}测试产物使用规范路径且仍拒绝输出联接`, async t => {
    const parent = await createCanonicalTempDirectory('termous prepared alias ')
    t.after(() => rm(parent, { recursive: true, force: true }))
    const temporary = path.join(parent, 'temporary')
    const alias = path.join(parent, 'alias')
    await mkdir(temporary)
    try {
      await symlink(temporary, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('当前系统不允许创建测试用目录链接')
        return
      }
      throw error
    }
    assert.notEqual(await realpath(alias), alias)
    const root = await createDirectory('build-', alias)
    assert.equal(path.dirname(root), temporary)
    assert.equal(root, await realpath(root))
    await writeFile(path.join(root, '.termous-build-root.json'), JSON.stringify({ schema_version: 1, root }))
    const output = path.join(root, 'bin')
    await mkdir(output)
    assert.equal(requireManagedPath(root, output), output)

    const external = path.join(parent, 'external')
    await mkdir(external)
    const sentinel = path.join(external, 'keep.txt')
    await writeFile(sentinel, 'keep')
    const linked = path.join(output, 'linked')
    await symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => requireManagedPath(root, path.join(linked, 'new-output')), /受管构建路径不能经过链接/)
    assert.equal(await readFile(sentinel, 'utf8'), 'keep')
  })
}

test('普通开发输出保留原有目录', () => {
  const paths = buildOutputPaths(path.resolve('web-fixture'), {})
  assert.equal(paths.managed, false)
  assert.equal(paths.renderer, path.resolve('web-fixture/dist'))
})

test('真实 builder 文件匹配包含应用元数据，并排除源码目录中的旧产物', () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { getMainFileMatchers } = builderRequire('app-builder-lib/out/fileMatcher.js')
  const web = path.resolve('web-fixture')
  const output = path.resolve('build-fixture')
  const layout = { renderer: path.join(output, 'renderer'), electron: path.join(output, 'electron') }
  const packager = { info: { projectDir: web, buildResourcesDir: 'build',
    config: { files: preparedAppFiles(layout) }, debugLogger: { isEnabled: false } } }
  const matchers = getMainFileMatchers(web, path.join(output, 'app'), value => value,
    {}, packager, path.join(output, 'install'), false)
  const stat = { isDirectory: () => false }
  const root = matchers.find(matcher => matcher.from === web)
  assert.ok(root, '应用元数据必须有独立来源')
  assert.equal(root.createFilter()(path.join(web, 'package.json'), stat), true)
  assert.equal(root.createFilter()(path.join(web, 'dist/index.html'), stat), false)
  assert.equal(root.createFilter()(path.join(web, 'dist-electron/main.js'), stat), false)
  assert.equal(matchers.find(matcher => matcher.from === layout.renderer).createFilter()(
    path.join(layout.renderer, 'index.html'), stat), true)
})
