import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, Platform, Arch } from 'electron-builder'
import { requireManagedPath } from './output-paths.mjs'
import { sanitizePublishEnvironment, validatePackageArtifacts } from '../ci/build-local-package.mjs'
import { requireReleaseVersion } from '../ci/release-manifest-contract.mjs'

const webDirectory = fileURLToPath(new URL('../../', import.meta.url))

export function preparedAppFiles(layout) {
  // 外部 FileSet 不会自动加入应用元数据；根目录仅允许 package.json，避免读取旧 dist。
  return [
    'package.json',
    { from: layout.renderer, to: 'dist', filter: ['**/*'] },
    { from: layout.electron, to: 'dist-electron', filter: ['**/*'] },
  ]
}

export function validateLayout(layout) {
  if (layout.schema_version !== 1 || !['windows-x64', 'linux-x64', 'macos-arm64'].includes(layout.target)) throw new Error('不支持打包文件清单中的格式版本或目标平台')
  requireReleaseVersion(layout.version, '打包文件清单中的应用版本')
  if (path.resolve(layout.web_directory) !== path.resolve(webDirectory)) throw new Error('打包文件清单中的 Web 源码目录与当前仓库不匹配')
  if (!Array.isArray(layout.app_files) || layout.app_files.length === 0) throw new Error('打包文件清单缺少应用文件配置')
  for (const entry of layout.app_files) {
    if (!entry || !Array.isArray(entry.filter) || entry.filter.some(value => typeof value !== 'string')) {
      throw new Error('打包文件清单中的文件过滤规则不合法')
    }
    requireManagedPath(layout.root, entry.from)
  }
  for (const value of [layout.renderer, layout.electron, layout.skills, layout.output]) {
    requireManagedPath(layout.root, value)
  }
  if (layout.installer_include) requireManagedPath(layout.root, layout.installer_include)
  return layout
}

export async function packagePrepared(file, verifyOnly = false) {
  const layout = validateLayout(JSON.parse(await readFile(file, 'utf8')))
  const target = {
    'windows-x64': { platform: 'win32', arch: 'x64', targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64) },
    'linux-x64': { platform: 'linux', arch: 'x64', targets: Platform.LINUX.createTarget(['AppImage'], Arch.x64) },
    'macos-arm64': { platform: 'darwin', arch: 'arm64', targets: Platform.MAC.createTarget(['dmg', 'zip'], Arch.arm64) },
  }[layout.target]
  if (process.platform !== target.platform || process.arch !== target.arch) throw new Error('必须在对应原生平台打包')
  if (!verifyOnly) {
    const base = JSON.parse((await readFile(path.join(webDirectory, 'electron-builder.json5'), 'utf8'))
      .replace(/^\s*\/\/[^\r\n]*(?:\r?\n)?/, ''))
    const clean = sanitizePublishEnvironment(process.env)
    for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key]
    Object.assign(process.env, clean)
    // 适配器只消费通用产物目录，不负责外部服务或语言运行时的准备。
    await build({
      projectDir: webDirectory,
      targets: target.targets,
      publish: 'never',
      config: {
        ...base,
        extends: path.join(webDirectory, 'scripts/desktop-development/production-builder.mjs'),
        directories: { ...base.directories, output: layout.output },
        extraMetadata: { ...base.extraMetadata, version: layout.version },
        nsis: { ...base.nsis, ...(layout.installer_include ? { include: layout.installer_include } : {}) },
        files: preparedAppFiles(layout),
        extraFiles: [
          ...base.extraFiles.filter(item => item.from !== 'build/core' && item.to !== 'licenses/rdp'),
          ...layout.app_files.map(({ from, filter }) => ({ from, to: '.', filter })),
        ],
        extraResources: [
          ...base.extraResources.filter(item => item.to !== 'agent/skills'),
          { from: layout.skills, to: 'agent/skills', filter: ['**/*'] },
        ],
      },
    })
  }
  return validatePackageArtifacts({ outputDirectory: layout.output,
    platform: target.platform, arch: target.arch, version: layout.version })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  packagePrepared(process.argv[2], process.argv.includes('--verify-only')).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    // 构建器的异步清理可能调用 exit(0)，退出事件中保留实际失败状态。
    process.on('exit', () => { process.exitCode = 1 })
  })
}
