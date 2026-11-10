import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildDevelopmentCore } from './core-build.mjs'
import { captureBuildEnvironment } from './native-build.mjs'

async function prepareNativeSources(workspace) {
  const root = path.join(workspace, 'termous-libwebrtc')
  for (const target of ['windows/amd64', 'linux/amd64', 'darwin/arm64']) {
    const sdk = path.join(root, 'sdk', target)
    await mkdir(sdk, { recursive: true })
    await writeFile(path.join(sdk, 'manifest.json'), JSON.stringify({ target, sha256: 'fixture-sdk' }))
  }
  const native = path.join(root, 'internal', 'native', 'windows')
  await mkdir(native, { recursive: true })
  await writeFile(path.join(native, 'desktop.h'), 'fixture-header')
  return root
}

test('开发构建为三平台提供同目录且使用相同原生标签的两个产物', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-core-build-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await prepareNativeSources(workspace)
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const enabled of [true, false]) {
      const calls = []
      const executable = await buildDevelopmentCore({
        workspace, platform, arch: platform === 'darwin' ? 'arm64' : 'x64',
        env: { TERMOUS_DESKTOP_CAPTURE_NATIVE: enabled ? '1' : '0' },
        run: async (command, args, options) => {
          if (args[0] === 'env') return '-O2 -g\n'
          calls.push({ command, args, env: options?.env })
        },
      })
      assert.equal(calls.length, 2)
      const outputs = calls.map(({ command, args }) => {
        assert.equal(command, 'go')
        assert.equal(args.includes('-tags=desktopcapture_native'), enabled)
        return args[args.indexOf('-o') + 1]
      })
      assert.equal(outputs[1], executable)
      assert.equal(path.dirname(outputs[0]), path.dirname(executable))
      assert.equal(path.basename(outputs[0]), platform === 'win32' ? 'termous-desktop.exe' : 'termous-desktop')
      assert.equal(calls[0].env.CGO_CXXFLAGS, calls[1].env.CGO_CXXFLAGS)
      if (enabled) assert.match(calls[0].env.CGO_CXXFLAGS, /^-O2 -g -DTERMOUS_CAPTURE_SOURCE_[a-f0-9]{64}=1$/)
      else assert.equal(calls[0].env.CGO_CXXFLAGS, undefined)
    }
  }
})

test('Windows 成组构建为三个真实输出生成摘要清单，管理服务不带原生标签', async t => {
  const root = fileURLToPath(new URL('../../../TEMP/desktopd-build-tests/', import.meta.url))
  await mkdir(root, { recursive: true })
  const workspace = await mkdtemp(path.join(root, 'group-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await prepareNativeSources(workspace)
  const calls = []
  const core = await buildDevelopmentCore({ workspace, platform: 'win32', arch: 'x64', env: {}, includeDaemon: true,
    run: async (command, args) => {
      if (args[0] === 'env') return '-O2 -g'
      calls.push(args)
      await writeFile(args[args.indexOf('-o') + 1], args.at(-1))
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(calls[2].includes('-tags=desktopcapture_native'), false)
  const manifest = JSON.parse(await readFile(path.join(path.dirname(core), 'desktop-bundle.json'), 'utf8'))
  assert.equal(manifest.protocol_version, 3)
  assert.equal(Object.keys(manifest.sha256).length, 3)
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    assert.equal(hash, createHash('sha256').update(await readFile(path.join(path.dirname(core), name))).digest('hex'))
  }
})

test('桌面进程构建失败时不继续构建或启动 Core', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-core-failure-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await prepareNativeSources(workspace)
  const calls = []
  await assert.rejects(buildDevelopmentCore({
    workspace, env: {}, run: async (command, args) => {
      assert.equal(command, 'go')
      if (args[0] === 'env') return '-O2 -g'
      calls.push(args.at(-1))
      throw new Error('构建失败')
    },
  }), /构建失败/)
  assert.deepEqual(calls, ['./cmd/termous-desktop'])
})

test('SDK 或原生子目录头文件更新会使开发构建缓存失效，保留 Go 参数且不修改原环境', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-native-cache-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const root = await prepareNativeSources(workspace)
  const env = { CGO_CXXFLAGS: '-O3 -g', TERMOUS_DESKTOP_CAPTURE_NATIVE: '1' }
  const options = { workspace, env, platform: 'win32', arch: 'x64', run: async (command, args, options) => {
    assert.equal(command, 'go')
    assert.deepEqual(args, ['env', 'CGO_CXXFLAGS'])
    assert.equal(options.env, env)
    assert.equal(options.captureOutput, true)
    return env.CGO_CXXFLAGS + '\n'
  } }
  const first = await captureBuildEnvironment(options)
  assert.deepEqual(await captureBuildEnvironment(options), first)
  await writeFile(path.join(root, 'sdk/windows/amd64/manifest.json'), 'new-sdk')
  const second = await captureBuildEnvironment(options)
  assert.notEqual(second.CGO_CXXFLAGS, first.CGO_CXXFLAGS)
  await writeFile(path.join(root, 'internal/native/windows/desktop.h'), 'new-header')
  const third = await captureBuildEnvironment(options)
  assert.notEqual(third.CGO_CXXFLAGS, second.CGO_CXXFLAGS)
  assert.match(third.CGO_CXXFLAGS, /^-O3 -g -DTERMOUS_CAPTURE_SOURCE_/)
  assert.equal(env.CGO_CXXFLAGS, '-O3 -g')
})

test('精简开发构建无需原生 SDK，原生 SDK 缺失时明确失败', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-native-disabled-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const run = async () => { assert.fail('此路径不应启动 Go') }
  for (const env of [{ CGO_ENABLED: '0' }, { TERMOUS_DESKTOP_CAPTURE_NATIVE: '0' }]) {
    assert.equal(await captureBuildEnvironment({ workspace, env, run, platform: 'win32', arch: 'x64' }), env)
  }
  await assert.rejects(captureBuildEnvironment({ workspace, env: {}, run, platform: 'win32', arch: 'x64' }), { code: 'ENOENT' })
})
