import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const targets = { 'win32-x64': 'windows/amd64', 'linux-x64': 'linux/amd64', 'darwin-arm64': 'darwin/arm64' }

async function nativeHeaders(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) files.push(...await nativeHeaders(path.join(directory, entry.name), relative + '/'))
    else if (entry.isFile() && /\.(h|inc)$/.test(entry.name)) files.push(relative)
  }
  return files
}

// cgo 不自动追踪子目录头文件和静态归档，用同一摘要驱动 Core 与 desktop 的增量重编译。
export async function captureBuildEnvironment({ workspace, env, run, platform, arch }) {
  const target = targets[`${platform}-${arch}`]
  if (!target || env.CGO_ENABLED === '0' || env.TERMOUS_DESKTOP_CAPTURE_NATIVE === '0') return env
  const root = path.join(workspace, 'termous-libwebrtc')
  const native = path.join(root, 'internal', 'native')
  const digest = createHash('sha256')
  digest.update(await readFile(path.join(root, 'sdk', target, 'manifest.json')))
  for (const relative of (await nativeHeaders(native)).sort()) {
    digest.update(relative + '\0')
    digest.update(await readFile(path.join(native, relative)))
    digest.update('\0')
  }
  // 从 Go 读取最终生效参数，保留开发者的环境及 GOENV 优化／调试配置。
  const flags = await run('go', ['env', 'CGO_CXXFLAGS'], { env, captureOutput: true })
  return { ...env, CGO_CXXFLAGS: `${flags.trim()} -DTERMOUS_CAPTURE_SOURCE_${digest.digest('hex')}=1` }
}
