import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const bash = process.env.TERMOUS_TEST_BASH || (process.platform === 'win32' ? undefined : '/bin/bash')
const source = (await readFile(new URL('./build-unix.sh', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
// 仅执行真实脚本的 SDK 探测段，不触发构建目录清理、依赖安装或打包。
const probe = source.match(/^ {4}mac_fuse_include=""\n[\s\S]*?^ {4}export CPATH=[^\n]+/m)?.[0]
assert.ok(probe, '未找到 macFUSE SDK 探测逻辑')

const defaults = [
  '/usr/local/include/fuse',
  '/usr/local/include/osxfuse/fuse',
  '/Library/Frameworks/macFUSE.framework/Headers',
  '/opt/homebrew/include/fuse',
]

function runProbe(cpath, cwd) {
  // 使用受控环境，避免加载调用者的 Bash 启动文件或继承其编译搜索路径。
  const env = { PATH: process.env.PATH, LC_ALL: 'C' }
  if (cpath !== undefined) env.CPATH = cpath
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c',
    `set -Eeuo pipefail\n${probe}\nprintf '%s' "$CPATH"`,
  ], { cwd, env, encoding: 'utf8', timeout: 10_000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null, result.stderr)
  return result
}

for (const [name, cpath] of [['未设置', undefined], ['空值', ''], ['只有分隔符', '::']]) {
  test(`macFUSE SDK 探测兼容严格模式下 CPATH ${name}`, { skip: !bash }, () => {
    const result = runProbe(cpath)
    // Git Bash 的 POSIX 路径与 Windows 不同；原生 Unix 按实际文件核对默认目录顺序。
    if (process.platform !== 'win32') {
      const installed = defaults.find((directory) => statSync(`${directory}/fuse.h`, { throwIfNoEntry: false })?.isFile())
      assert.equal(result.status, installed ? 0 : 1, result.stderr)
      if (installed) assert.equal(result.stdout, installed + (cpath ? `:${cpath}` : ''))
    }
    if (result.status === 0) {
      const selected = result.stdout.split(':')[0]
      assert.ok(defaults.includes(selected), result.stdout)
      assert.equal(result.stdout, selected + (cpath ? `:${cpath}` : ''))
      assert.equal(result.stderr, '')
    } else {
      // 未安装 SDK 的主机应给出依赖诊断，而不是因空数组提前终止。
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr.trim(), '缺少 macFUSE SDK 头文件；请准备构建依赖，不会自动安装。')
    }
  })
}

for (const [name, cpath, selected] of [
  ['自定义目录优先', 'first include:second include', 'first include'],
  ['跳过缺少头文件的目录', 'missing:second include:first include', 'second include'],
  ['保留空项与含空格的目录', ':missing::first include:', 'first include'],
]) {
  test(`macFUSE SDK 探测${name}并保留原 CPATH`, { skip: !bash }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'termous-macfuse-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    for (const directory of ['first include', 'second include']) {
      await mkdir(path.join(root, directory))
      await writeFile(path.join(root, directory, 'fuse.h'), '')
    }
    const result = runProbe(cpath, root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout, `${selected}:${cpath}`)
  })
}
