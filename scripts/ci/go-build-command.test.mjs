import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const bash = process.env.TERMOUS_TEST_BASH || (process.platform === 'win32' ? undefined : '/bin/bash')
const cacheKeys = ['GOCACHE', 'GOMODCACHE', 'GOTMPDIR', 'TEMP', 'TMP', 'TMPDIR']

test('Windows 兼容入口转交配置与版本，保留调用方缓存', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'termous build 代理 ')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = fileURLToPath(new URL('./build-windows.ps1', import.meta.url))
  await writeFile(path.join(root, 'build.py'), `import json,os,sys
print(json.dumps({'args':sys.argv[1:], 'cache':os.environ.get('GOCACHE')}))
`)
  const config = path.join(root, 'local config.json')
  const options = { cwd: root, encoding: 'utf8', timeout: 15_000, env: {
    ...process.env, GITHUB_ACTIONS: 'false', TERMOUS_BUILDTOOLS_DIR: root, TERMOUS_BUILD_CONFIG: config,
    TERMOUS_BUILD_PHASE: 'prepare', TERMOUS_VERSION: '1.2.3', GOCACHE: 'inherited-cache',
  } }
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', entry], options)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    args: ['build', '--config', config, '--phase', 'prepare', '--version', '1.2.3'], cache: 'inherited-cache',
  })
  await writeFile(path.join(root, 'build.py'), 'raise SystemExit(7)\n')
  const failed = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', entry], options)
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /7/)
})

for (const actions of [false, true]) {
  test(`Unix Go 参数及${actions ? 'Actions' : '本地'}缓存`, { skip: !bash }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'termous go command-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const source = (await readFile(new URL('./build-unix.sh', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
    const cache = source.match(/configure_local_go_cache\(\) \{[\s\S]*?\n\}/)?.[0]
    const commands = source.match(/^ {2}run_step "Go tests"[\s\S]*?^ {4}\.\/cmd\/termous-core/m)?.[0]
    assert.ok(cache)
    assert.ok(commands)
    const code = `set -Eeuo pipefail
export PATH="/usr/bin:$PATH"
workspace_dir="$PWD"
core_dir="$PWD"
core_binary="$PWD/output directory/termous-core"
version=1.2.3-review
mount_tags=mountfuse,fuse3
${cacheKeys.map(key => `export ${key}=preserved-cache`).join('\n')}
${cache}
configure_local_go_cache
run_step() {
  [[ "$2" == "$core_dir" && "$3" == go ]]
  shift 3
  printf '%s\\0' "$@"
  printf '\\n'
}
${commands}
printf '%s\\0' ${cacheKeys.map(key => `"$${key}"`).join(' ')}
printf '\\n'
`
    const env = { ...process.env, GITHUB_ACTIONS: String(actions) }
    for (const key of cacheKeys) env[key] = root
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', code], { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    const [tests, build, caches] = result.stdout.trimEnd().split(/\r?\n/).map(line => line.split('\0').slice(0, -1))
    assert.deepEqual(tests, ['test', '-tags', 'mountfuse,fuse3', './...'])
    assert.deepEqual(build, ['build', '-tags', 'mountfuse,fuse3', '-mod=readonly', '-trimpath', '-buildvcs=false',
      '-ldflags', '-s -w -X termous/backend/internal/platform/buildinfo.Version=1.2.3-review',
      '-o', build.at(-2), './cmd/termous-core'])
    if (actions) assert.deepEqual(caches, cacheKeys.map(() => 'preserved-cache'))
    else for (const [index, suffix] of ['build', 'mod', 'tmp', 'tmp', 'tmp', 'tmp'].entries()) {
      assert.ok(caches[index].replaceAll('\\', '/').endsWith(`/TEMP/go/${suffix}`))
      assert.ok((await stat(path.join(root, 'TEMP/go', suffix))).isDirectory())
    }
  })
}

test('Windows RDP 构建把具名参数及含空格路径传给 PowerShell 脚本', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'termous rdp command-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = (await readFile(new URL('./build-windows.ps1', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const invoke = source.match(/function Invoke-Native \{[\s\S]*?\n\}/)?.[0]
  const resolveDirectory = source.match(/function Resolve-ExistingDirectory \{[\s\S]*?\n\}/)?.[0]
  const toolchain = source.match(/function Enable-MingwToolchain \{[\s\S]*?\n\}/)?.[0]
  const command = source.match(/^ {2}Invoke-Native -Name "Build Termous RDP"[\s\S]*?^ {2}\) -WorkingDirectory \$rdpDir/m)?.[0]
  assert.ok(invoke)
  assert.ok(resolveDirectory)
  assert.ok(toolchain)
  assert.ok(command)
  const msys2Root = path.join(root, 'MSYS2 directory')
  const requiredTools = ['usr/bin/bash.exe', 'mingw64/bin/gcc.exe', 'mingw64/bin/g++.exe']
  for (const tool of requiredTools) {
    const target = path.join(msys2Root, tool)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, '')
  }
  const standalone = path.join(root, 'standalone', 'bin')
  await mkdir(standalone, { recursive: true })
  await writeFile(path.join(standalone, 'gcc.exe'), '')
  await mkdir(path.join(root, 'scripts'))
  await writeFile(path.join(root, 'scripts', 'build.ps1'), `
param([ValidateSet('help', 'build', 'test')][string]$Action, [string]$Msys2Root)
ConvertTo-Json -Compress @{ action = $Action; root = $Msys2Root; compiler = (Get-Command gcc).Source; extra = @($args) }
exit 0
`)
  const shellArguments = ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$rdpDir = $PWD.Path
${resolveDirectory}
${toolchain}
$env:Path = "$(Join-Path $PWD 'standalone/bin');$env:Path"
$rdpMsys2Root = Enable-MingwToolchain
${invoke}
${command}
Write-Output 'build-completed'
`]
  const options = { cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, TERMOUS_MSYS2_ROOT: msys2Root } }
  const result = spawnSync('pwsh', shellArguments, options)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const record = result.stdout.split(/\r?\n/).find((line) => line.startsWith('{'))
  assert.ok(record, result.stdout)
  assert.deepEqual(JSON.parse(record), { action: 'build', root: msys2Root, compiler: path.join(msys2Root, 'mingw64/bin/gcc.exe'), extra: [] })
  assert.match(result.stdout, /build-completed/)
  for (const tool of requiredTools) {
    const target = path.join(msys2Root, tool)
    await rm(target)
    const missing = spawnSync('pwsh', shellArguments, options)
    assert.ifError(missing.error)
    assert.equal(missing.status, 1, missing.stderr)
    assert.ok(missing.stderr.includes(`MSYS2 缺少 ${tool}`), missing.stderr)
    assert.doesNotMatch(missing.stdout, /build-completed/)
    await writeFile(target, '')
  }
  await writeFile(path.join(root, 'scripts', 'build.ps1'), 'exit 7\n')
  const failed = spawnSync('pwsh', shellArguments, options)
  assert.ifError(failed.error)
  assert.equal(failed.status, 1, failed.stderr)
  assert.match(failed.stderr, /退出码: 7/)
  assert.doesNotMatch(failed.stdout, /build-completed/)
})
