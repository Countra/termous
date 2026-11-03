import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// 稳定的开发产物位置使 macOS 权限归属不随 go run 临时目录变化。
export async function buildDevelopmentCore({ workspace, env, run, platform = process.platform, arch = process.arch }) {
  const directory = path.join(workspace, 'TEMP', 'core-development', `${platform}-${arch}`)
  await mkdir(directory, { recursive: true })
  const suffix = platform === 'win32' ? '.exe' : ''
  const tags = env.TERMOUS_DESKTOP_CAPTURE_NATIVE === '0' ? [] : ['-tags=desktopcapture_native']
  for (const name of ['termous-desktop', 'termous-core']) {
    await run('go', ['build', ...tags, '-o', path.join(directory, name + suffix), `./cmd/${name}`])
  }
  return path.join(directory, `termous-core${suffix}`)
}
