import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { compareRuntimeFiles, verifyNsisRuntime, withNsisCompatibility } from '../build/nsis-runtime.mjs'

test('NSIS 压缩限定 Windows，结束或失败后还原调用者环境', async () => {
  const previous = process.env.ELECTRON_BUILDER_7Z_FILTER
  try {
    process.env.ELECTRON_BUILDER_7Z_FILTER = 'ARM'
    await withNsisCompatibility('linux-x64', async () => {
      assert.equal(process.env.ELECTRON_BUILDER_7Z_FILTER, 'ARM')
    })
    await withNsisCompatibility('windows-x64', async () => {
      assert.equal(process.env.ELECTRON_BUILDER_7Z_FILTER, 'BCJ')
    })
    assert.equal(process.env.ELECTRON_BUILDER_7Z_FILTER, 'ARM')
    delete process.env.ELECTRON_BUILDER_7Z_FILTER
    await assert.rejects(withNsisCompatibility('windows-x64', async () => { throw new Error('构建失败') }), /构建失败/)
    assert.equal(process.env.ELECTRON_BUILDER_7Z_FILTER, undefined)
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_BUILDER_7Z_FILTER
    else process.env.ELECTRON_BUILDER_7Z_FILTER = previous
  }
})

test('解压检查拒绝漏文件、等长损坏和额外文件，保留空锁文件', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'termous-runtime-files-'))
  try {
    const expected = path.join(directory, 'expected')
    const actual = path.join(directory, 'actual')
    await mkdir(expected)
    await mkdir(actual)
    await writeFile(path.join(expected, '.runtime-use.lock'), '')
    await writeFile(path.join(actual, '.runtime-use.lock'), '')
    await writeFile(path.join(expected, 'template.exe'), 'fixture')
    await assert.rejects(compareRuntimeFiles(expected, actual), /遗漏.*template\.exe/)
    await writeFile(path.join(actual, 'template.exe'), 'changed')
    await assert.rejects(compareRuntimeFiles(expected, actual), /内容不一致.*template\.exe/)
    await writeFile(path.join(actual, 'template.exe'), 'fixture')
    assert.equal(await compareRuntimeFiles(expected, actual), 2)
    await writeFile(path.join(actual, 'extra'), '')
    await assert.rejects(compareRuntimeFiles(expected, actual), /额外运行组件.*extra/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// 合成 PE 只供压缩器识别 ARM64，不是可执行程序，也不会作为程序启动。
function arm64Template() {
  const data = Buffer.alloc(16384)
  data.write('MZ')
  data.writeUInt32LE(0x80, 0x3c)
  data.write('PE\0\0', 0x80)
  data.writeUInt16LE(0xaa64, 0x84)
  data.writeUInt16LE(1, 0x86)
  data.writeUInt16LE(0xf0, 0x94)
  data.writeUInt16LE(0x22, 0x96)
  data.writeUInt16LE(0x20b, 0x98)
  const section = 0x98 + 0xf0
  data.write('.text', section)
  for (const [offset, value] of [[8, 0x3e00], [12, 0x1000], [16, 0x3e00], [20, 0x200], [36, 0x60000020]]) {
    data.writeUInt32LE(value, section + offset)
  }
  for (let offset = 0x200; offset < data.length; offset += 4) data.writeUInt32LE((0x94000000 | offset) >>> 0, offset)
  return data
}

const cache = path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder/Cache')
const compiler = process.env.TERMOUS_TEST_MAKENSIS ?? path.join(cache, 'nsis/nsis-3.0.4.1/makensis.exe')
const plugins = process.env.TERMOUS_TEST_NSIS_PLUGINS ?? path.join(cache, 'nsis/nsis-resources-3.4.1/plugins')
const sevenZip = process.env.TERMOUS_TEST_7ZA ?? path.join(cache, '7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe')
const available = process.platform === 'win32' && [compiler, sevenZip, path.join(plugins, 'x86-unicode/nsis7z.dll')].every(existsSync)

test('构建器压缩参数与真实 NSIS 插件完整往返 ARM64 模板、中文路径和空文件', { skip: !available, timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'termous-nsis-中文 $INSTDIR-'))
  try {
    const unpacked = path.join(directory, 'unpacked')
    const runtime = path.join(unpacked, 'runtime/python')
    await mkdir(runtime, { recursive: true })
    await writeFile(path.join(runtime, 'arm64-template.exe'), arm64Template())
    await writeFile(path.join(runtime, '.runtime-use.lock'), '')
    const require = createRequire(import.meta.resolve('electron-builder'))
    const { compute7zCompressArgs } = require('app-builder-lib/out/targets/archive.js')
    const archive = path.join(directory, 'app.7z')
    await withNsisCompatibility('windows-x64', async () => {
      execFileSync(sevenZip, [...compute7zCompressArgs('7z', { solid: false }), archive, '.'], {
        cwd: unpacked, windowsHide: true, timeout: 30000,
      })
    })
    await verifyNsisRuntime({ archive, unpacked, work: directory, tools: { compiler: { path: compiler }, plugins } })
    // 解压进程成功退出也不能掩盖漏文件，失败目录保留供构建日志排查。
    await writeFile(path.join(runtime, 'missing-template.exe'), 'fixture')
    await assert.rejects(verifyNsisRuntime({ archive, unpacked, work: directory,
      tools: { compiler: { path: compiler }, plugins } }), /遗漏.*missing-template\.exe[\s\S]*验收目录/)
    assert.equal((await readdir(directory)).filter(name => name.startsWith('nsis-runtime-')).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
