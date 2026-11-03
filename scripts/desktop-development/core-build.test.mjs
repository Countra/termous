import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildDevelopmentCore } from './core-build.mjs'

test('开发构建为三平台提供同目录且使用相同原生标签的两个产物', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-core-build-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const enabled of [true, false]) {
      const calls = []
      const executable = await buildDevelopmentCore({
        workspace, platform, arch: platform === 'darwin' ? 'arm64' : 'x64',
        env: { TERMOUS_DESKTOP_CAPTURE_NATIVE: enabled ? '1' : '0' },
        run: async (command, args) => { calls.push({ command, args }) },
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
    }
  }
})

test('桌面进程构建失败时不继续构建或启动 Core', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'termous-core-failure-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const calls = []
  await assert.rejects(buildDevelopmentCore({
    workspace, env: {}, run: async (command, args) => {
      assert.equal(command, 'go')
      calls.push(args.at(-1))
      throw new Error('构建失败')
    },
  }), /构建失败/)
  assert.deepEqual(calls, ['./cmd/termous-desktop'])
})
