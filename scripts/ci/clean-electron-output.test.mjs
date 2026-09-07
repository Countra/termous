import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  cleanElectronOutput,
  requireElectronOutputPath,
} from './clean-electron-output.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDirectory = path.resolve(scriptDirectory, '..', '..')

test('Electron 输出清理只删除 dist-electron 并保留相邻目录', async (context) => {
  const fixture = await temporaryWebDirectory(context)
  const outputDirectory = path.join(fixture, 'dist-electron')
  const rendererDirectory = path.join(fixture, 'dist')
  const similarlyNamedDirectory = path.join(fixture, 'dist-electron-backup')
  await mkdir(path.join(outputDirectory, 'chunks'), { recursive: true })
  await mkdir(rendererDirectory)
  await mkdir(similarlyNamedDirectory)
  await writeFile(path.join(outputDirectory, 'chunks', 'legacy.js'), 'legacy')
  await writeFile(path.join(rendererDirectory, 'index.html'), 'renderer')
  await writeFile(path.join(similarlyNamedDirectory, 'keep.js'), 'keep')

  assert.equal(
    await cleanElectronOutput({ webDirectory: fixture }),
    outputDirectory,
  )
  await assert.rejects(lstat(outputDirectory), { code: 'ENOENT' })
  assert.equal(
    await readFile(path.join(rendererDirectory, 'index.html'), 'utf8'),
    'renderer',
  )
  assert.equal(
    await readFile(path.join(similarlyNamedDirectory, 'keep.js'), 'utf8'),
    'keep',
  )
})

test('Electron 输出目录不存在时清理保持幂等', async (context) => {
  const fixture = await temporaryWebDirectory(context)
  const expected = path.join(fixture, 'dist-electron')

  assert.equal(
    await cleanElectronOutput({ webDirectory: fixture }),
    expected,
  )
  assert.equal(
    await cleanElectronOutput({ webDirectory: fixture }),
    expected,
  )
})

test('Electron 输出路径校验拒绝根目录、嵌套目录和相似目录名', () => {
  const fixture = path.resolve(os.tmpdir(), 'termous-electron-clean-boundary')
  for (const unsafePath of [
    fixture,
    path.dirname(fixture),
    path.join(fixture, 'dist-electron', 'chunks'),
    path.join(fixture, 'dist-electron-backup'),
  ]) {
    assert.throws(
      () => requireElectronOutputPath(fixture, unsafePath),
      /必须是 Web 项目直属的 dist-electron/u,
      unsafePath,
    )
  }
})

test('Electron 输出清理拒绝符号链接或目录联接', async (context) => {
  const fixture = await temporaryWebDirectory(context)
  const externalDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'termous-electron-clean-external-'),
  )
  context.after(() => rm(externalDirectory, { recursive: true, force: true }))
  await writeFile(path.join(externalDirectory, 'keep.js'), 'keep')

  try {
    await symlink(
      externalDirectory,
      path.join(fixture, 'dist-electron'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      context.skip('当前 Windows 用户无创建目录联接权限')
      return
    }
    throw error
  }

  await assert.rejects(
    cleanElectronOutput({ webDirectory: fixture }),
    /不能是符号链接或目录联接/u,
  )
  assert.equal(
    await readFile(path.join(externalDirectory, 'keep.js'), 'utf8'),
    'keep',
  )
})

test('build:renderer 在 Skills 校验成功后、Vite 构建前清理 Electron 输出', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(webDirectory, 'package.json'), 'utf8'),
  )
  assert.match(
    packageJson.scripts['build:renderer'],
    /^pnpm run build:skills && node scripts\/ci\/clean-electron-output\.mjs && vite build/u,
  )
})

async function temporaryWebDirectory(context) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'termous-electron-clean-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
