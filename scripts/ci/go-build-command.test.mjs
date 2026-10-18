import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const bash = process.env.TERMOUS_TEST_BASH || (process.platform === 'win32' ? undefined : '/bin/bash')
const cacheKeys = ['GOCACHE', 'GOMODCACHE', 'GOTMPDIR', 'TEMP', 'TMP', 'TMPDIR']

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

for (const windows of [false, true]) {
  const shell = windows ? (process.platform === 'win32' ? 'pwsh' : undefined) : bash
  for (const actions of [false, true]) {
    test(`${windows ? 'Windows' : 'Unix'} Go 命令参数及${actions ? 'Actions' : '本地'}缓存`, { skip: !shell }, async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'termous go command-'))
      t.after(() => rm(root, { recursive: true, force: true }))
      const source = (await readFile(new URL(windows ? './build-windows.ps1' : './build-unix.sh', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
      // 只执行真实缓存函数及命令段，以记录器替代 Go 调用，不触发清理、安装或打包。
      const cache = source.match(windows ? /function Set-LocalGoCache \{[\s\S]*?\n\}/ : /configure_local_go_cache\(\) \{[\s\S]*?\n\}/)?.[0]
      const commands = source.match(windows
        ? /^ {2}Invoke-Native -Name "Go tests"[\s\S]*?^ {2}\) -WorkingDirectory \$coreDir/m
        : /^ {2}run_step "Go tests"[\s\S]*?^ {4}\.\/cmd\/termous-core/m)?.[0]
      assert.ok(cache)
      assert.ok(commands)
      assert.match(source, windows ? /if \(\$phase -in[^\n]+\{\n {2}Set-LocalGoCache/ : /if \[\[ "\$build_phase"[^\n]+then\n {2}configure_local_go_cache/)
      assert.doesNotMatch(source, /GOFLAGS[^\n]*-ldflags/)
      const code = windows ? `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$workspaceDir = $PWD.Path
$coreDir = $PWD.Path
$coreExe = Join-Path $PWD 'output directory/termous-core.exe'
$version = '1.2.3-review'
${cacheKeys.map((key) => `$env:${key} = 'preserved-cache'`).join('\n')}
${cache}
Set-LocalGoCache
function Invoke-Native($Name, $FilePath, $Arguments, $WorkingDirectory) {
  if ($FilePath -ne 'go' -or $WorkingDirectory -ne $coreDir) { throw '构建目标错误' }
  ConvertTo-Json -InputObject $Arguments -Compress
}
${commands}
ConvertTo-Json -InputObject @(${cacheKeys.map((key) => `$env:${key}`).join(',')}) -Compress
` : `set -Eeuo pipefail
export PATH="/usr/bin:$PATH"
workspace_dir="$PWD"
core_dir="$PWD"
core_binary="$PWD/output directory/termous-core"
version=1.2.3-review
mount_tags=mountfuse,fuse3
${cacheKeys.map((key) => `export ${key}=preserved-cache`).join('\n')}
${cache}
configure_local_go_cache
run_step() {
  [[ "$2" == "$core_dir" && "$3" == go ]]
  shift 3
  printf '%s\\0' "$@"
  printf '\\n'
}
${commands}
printf '%s\\0' ${cacheKeys.map((key) => `"$${key}"`).join(' ')}
printf '\\n'
`
      const env = { ...process.env, GITHUB_ACTIONS: String(actions) }
      for (const key of cacheKeys) env[key] = root
      const result = spawnSync(shell, windows ? ['-NoProfile', '-NonInteractive', '-Command', code] : ['--noprofile', '--norc', '-c', code], {
        cwd: root, env, encoding: 'utf8', timeout: 15_000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      const records = result.stdout.trimEnd().split(/\r?\n/).map((line) => windows ? JSON.parse(line) : line.split('\0').slice(0, -1))
      assert.equal(records.length, 3, result.stdout)
      const [tests, build, caches] = records
      const tags = windows ? 'mountfuse' : 'mountfuse,fuse3'
      assert.deepEqual(tests, ['test', '-tags', tags, './...'])
      assert.deepEqual(build, ['build', '-tags', tags, '-mod=readonly', '-trimpath', '-buildvcs=false',
        '-ldflags', '-s -w -X termous/backend/internal/platform/buildinfo.Version=1.2.3-review',
        '-o', build.at(-2), './cmd/termous-core'])
      assert.ok(build.at(-2).replaceAll('\\', '/').endsWith(`/output directory/termous-core${windows ? '.exe' : ''}`))
      if (actions) {
        assert.deepEqual(caches, cacheKeys.map(() => 'preserved-cache'))
      } else {
        for (const [index, suffix] of ['build', 'mod', 'tmp', 'tmp', 'tmp', 'tmp'].entries()) {
          assert.ok(caches[index].replaceAll('\\', '/').endsWith(`/TEMP/go/${suffix}`))
          assert.ok((await stat(path.join(root, 'TEMP/go', suffix))).isDirectory())
        }
      }
    })
  }
}
