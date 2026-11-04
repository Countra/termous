import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// 稳定的开发产物位置使 macOS 权限归属不随 go run 临时目录变化。
export async function buildDevelopmentCore({ workspace, env, run, platform = process.platform, arch = process.arch, includeDaemon = false }) {
  const directory = path.join(workspace, 'TEMP', 'core-development', `${platform}-${arch}`)
  await mkdir(directory, { recursive: true })
  const suffix = platform === 'win32' ? '.exe' : ''
  const tags = env.TERMOUS_DESKTOP_CAPTURE_NATIVE === '0' ? [] : ['-tags=desktopcapture_native']
  for (const name of ['termous-desktop', 'termous-core']) {
    await run('go', ['build', ...tags, '-o', path.join(directory, name + suffix), `./cmd/${name}`])
  }
  if (includeDaemon && platform === 'win32') {
    await buildDevelopmentDaemon({ workspace, env, run, platform, arch })
    const sha256 = {}
    for (const name of ['termous-core.exe', 'termous-desktop.exe', 'termous-desktopd.exe']) {
      sha256[name] = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex')
    }
    await writeFile(path.join(directory, 'desktop-bundle.json'), JSON.stringify({ protocol_version: 1, build_version: 'development', sha256 }, null, 2) + '\n')
  }
  return path.join(directory, `termous-core${suffix}`)
}

// 管理服务单独构建，不继承采集标签，也不覆盖正在调试的 Core。
export async function buildDevelopmentDaemon({ workspace, run, platform = process.platform, arch = process.arch }) {
  if (platform !== 'win32') throw new Error('desktopd 当前仅支持 Windows；其他平台使用 direct 模式。')
  const directory = path.join(workspace, 'TEMP', 'core-development', `${platform}-${arch}`)
  await mkdir(directory, { recursive: true })
  const output = path.join(directory, 'termous-desktopd.exe')
  await run('go', ['build', '-o', output, './cmd/termous-desktopd'])
  return output
}
