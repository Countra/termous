import { spawn } from 'node:child_process'
import {
  copyFile,
  lstat,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { publishCredentialNames } from '../ci/build-local-package.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultWebDirectory = path.resolve(scriptDirectory, '..', '..')
const baselineVersion = '0.0.1'
const candidateVersion = '0.0.2'
const expectedFeedURL = 'http://127.0.0.1:18991'
const simulationProductName = 'Termous Update Simulation'

export async function buildUpdateSimulationFixtures(
  options = {},
  dependencies = {},
) {
  const webDirectory = path.resolve(options.webDirectory ?? defaultWebDirectory)
  const outputRoot = path.resolve(
    options.outputRoot
      ?? path.join(webDirectory, 'release', 'update-simulation'),
  )
  await assertSafeSimulationOutputRoot(outputRoot, webDirectory)

  const baselineDirectory = path.join(outputRoot, 'baseline')
  const candidateDirectory = path.join(outputRoot, 'candidate')
  const spawnProcess = dependencies.spawnProcess ?? spawnAndWait
  const environment = sanitizeSimulationEnvironment(
    dependencies.environment ?? process.env,
  )
  const viteCli = path.join(webDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
  const builderCli = path.join(
    webDirectory,
    'node_modules',
    'electron-builder',
    'cli.js',
  )
  const productionEnvironment = { ...environment }

  await rm(outputRoot, { force: true, recursive: true })
  let fixtureFailure = null
  try {
    await rm(path.join(webDirectory, 'dist-electron'), {
      force: true,
      recursive: true,
    })
    await spawnProcess(process.execPath, [viteCli, 'build'], {
      cwd: webDirectory,
      env: {
        ...environment,
        TERMOUS_BUILD_UPDATE_SIMULATION: '1',
        VITE_TERMOUS_APP_VERSION: baselineVersion,
      },
    })
    await spawnProcess(process.execPath, [
      builderCli,
      '--win',
      'nsis',
      '--x64',
      '--config',
      'electron-builder.update-simulation.json5',
      `--config.directories.output=${candidateDirectory}`,
      `--config.extraMetadata.version=${candidateVersion}`,
      '--publish',
      'never',
    ], {
      cwd: webDirectory,
      env: environment,
    })
    await spawnProcess(process.execPath, [
      builderCli,
      '--win',
      'dir',
      '--x64',
      '--config',
      'electron-builder.update-simulation.json5',
      `--config.directories.output=${baselineDirectory}`,
      `--config.extraMetadata.version=${baselineVersion}`,
      '--publish',
      'never',
    ], {
      cwd: webDirectory,
      env: environment,
    })
    await copyFile(
      path.join(
        candidateDirectory,
        'win-unpacked',
        'resources',
        'app-update.yml',
      ),
      path.join(
        baselineDirectory,
        'win-unpacked',
        'resources',
        'app-update.yml',
      ),
    )
  } catch (error) {
    fixtureFailure = error
  }

  let restorationFailure = null
  try {
    // 模拟入口只用于专用 fixture，完成后立即恢复正式 Renderer 与 Electron 主入口。
    await rm(path.join(webDirectory, 'dist-electron'), {
      force: true,
      recursive: true,
    })
    await spawnProcess(process.execPath, [viteCli, 'build'], {
      cwd: webDirectory,
      env: productionEnvironment,
    })
  } catch (error) {
    restorationFailure = error
  }
  if (fixtureFailure && restorationFailure) {
    throw new AggregateError(
      [fixtureFailure, restorationFailure],
      '模拟 fixture 构建失败，且正式构建恢复也失败',
    )
  }
  if (fixtureFailure) {
    throw fixtureFailure
  }
  if (restorationFailure) {
    throw restorationFailure
  }

  const result = await validateUpdateSimulationFixtures({
    baselineDirectory,
    candidateDirectory,
  })
  await assertProductionBundleExcludesSimulation([
    path.join(webDirectory, 'dist'),
    path.join(webDirectory, 'dist-electron'),
  ])
  const descriptor = {
    baseline_version: baselineVersion,
    candidate_version: candidateVersion,
    baseline_executable: path.relative(outputRoot, result.baselineExecutable),
    feed_root: path.relative(outputRoot, candidateDirectory),
    installer: path.relative(outputRoot, result.installer),
    manifest: path.relative(outputRoot, result.manifest),
  }
  await writeFile(
    path.join(outputRoot, 'fixture.json'),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    'utf8',
  )
  return {
    ...result,
    descriptor,
    outputRoot,
  }
}

export async function validateUpdateSimulationFixtures({
  baselineDirectory,
  candidateDirectory,
}) {
  const baselineExecutable = path.join(
    baselineDirectory,
    'win-unpacked',
    'TermousUpdateSimulation.exe',
  )
  const appUpdatePath = path.join(
    baselineDirectory,
    'win-unpacked',
    'resources',
    'app-update.yml',
  )
  const markerPath = path.join(
    baselineDirectory,
    'win-unpacked',
    'resources',
    'update-simulation-profile.marker',
  )
  const manifest = path.join(candidateDirectory, 'latest.yml')
  await requireRegularFile(baselineExecutable, '基线模拟程序')
  await requireRegularFile(appUpdatePath, '基线 generic 更新配置')
  await requireRegularFile(markerPath, '模拟身份标记')
  await requireRegularFile(manifest, '候选更新清单')

  const appUpdate = parseYaml(await readFile(appUpdatePath, 'utf8'))
  if (
    appUpdate?.provider !== 'generic'
    || appUpdate?.url !== expectedFeedURL
    || appUpdate?.useMultipleRangeRequest !== false
    || appUpdate?.updaterCacheDirName !== 'termous-update-simulation-updater'
  ) {
    throw new Error('基线包没有使用固定的 loopback generic 更新源')
  }
  const marker = (await readFile(markerPath, 'utf8')).trim()
  if (marker !== 'termous-update-simulation-v1') {
    throw new Error('基线包模拟身份标记无效')
  }

  const manifestValue = parseYaml(await readFile(manifest, 'utf8'))
  if (
    manifestValue?.version !== candidateVersion
    || !Array.isArray(manifestValue.files)
    || manifestValue.files.length !== 1
  ) {
    throw new Error('候选更新清单不是预期的 0.0.2 Windows 单载荷')
  }
  const installerName = manifestValue.files[0]?.url
  if (
    typeof installerName !== 'string'
    || installerName !== path.basename(installerName)
    || !installerName.endsWith('.exe')
    || !installerName.startsWith(`${simulationProductName.replaceAll(' ', '-')}-`)
  ) {
    throw new Error('候选安装器名称无效')
  }
  const installer = path.join(candidateDirectory, installerName)
  await requireRegularFile(installer, '候选安装器')
  await requireRegularFile(`${installer}.blockmap`, '候选安装器 blockmap')

  return {
    appUpdatePath,
    baselineExecutable,
    installer,
    manifest,
  }
}

export function sanitizeSimulationEnvironment(input) {
  const removedNames = new Set([
    ...publishCredentialNames,
    'WIN_CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'CSC_NAME',
    'CSC_IDENTITY_AUTO_DISCOVERY',
    'RELEASE_APP_ID',
    'RELEASE_APP_PRIVATE_KEY',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'TERMOUS_BUILD_UPDATE_SIMULATION',
  ].map((name) => name.toUpperCase()))
  const output = {}
  let inheritedNoProxy = ''
  let inheritedAppVersion
  for (const [name, value] of Object.entries(input)) {
    const normalizedName = name.toUpperCase()
    if (normalizedName === 'NO_PROXY') {
      inheritedNoProxy = name === 'NO_PROXY' || !inheritedNoProxy
        ? String(value ?? '')
        : inheritedNoProxy
      continue
    }
    if (normalizedName === 'VITE_TERMOUS_APP_VERSION') {
      inheritedAppVersion = name === 'VITE_TERMOUS_APP_VERSION'
        || inheritedAppVersion === undefined
        ? value
        : inheritedAppVersion
      continue
    }
    if (!removedNames.has(normalizedName)) {
      output[name] = value
    }
  }
  if (inheritedAppVersion !== undefined) {
    output.VITE_TERMOUS_APP_VERSION = inheritedAppVersion
  }
  output.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  output.NO_PROXY = appendNoProxy(inheritedNoProxy, '127.0.0.1')
  return output
}

export async function assertProductionBundleExcludesSimulation(distDirectories) {
  const roots = Array.isArray(distDirectories) ? distDirectories : [distDirectories]
  const files = (await Promise.all(roots.map(collectFiles))).flat()
  const forbidden = [
    'termous-update-simulation',
    'developmentUpdateSimulation',
    'simulation_install_blocked',
  ]
  for (const filePath of files) {
    if (!/\.(?:[cm]?js|css|html)$/.test(filePath)) {
      continue
    }
    const content = await readFile(filePath, 'utf8')
    const marker = forbidden.find((value) => content.includes(value))
    if (marker) {
      throw new Error(`生产构建包含开发模拟标记 ${marker}: ${filePath}`)
    }
  }
}

export async function assertSafeSimulationOutputRoot(
  outputRootValue,
  webDirectoryValue,
) {
  const outputRoot = path.resolve(outputRootValue)
  const webDirectory = path.resolve(webDirectoryValue)
  const expected = path.resolve(webDirectory, 'release', 'update-simulation')
  if (!samePath(outputRoot, expected)) {
    throw new Error(`模拟输出目录必须固定为 ${expected}`)
  }
  await requireCanonicalDirectory(webDirectory, '模拟项目目录')
  await requireCanonicalDirectoryIfPresent(
    path.join(webDirectory, 'release'),
    '模拟 release 目录',
  )
  await requireCanonicalDirectoryIfPresent(outputRoot, '模拟输出目录')
}

async function requireCanonicalDirectoryIfPresent(directory, label) {
  let info
  try {
    info = await lstat(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }
    throw new Error(`${label}无法检查: ${directory}`, { cause: error })
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label}不能是符号链接、联接或普通文件: ${directory}`)
  }
  const actual = await realpath(directory)
  if (!samePath(actual, directory)) {
    throw new Error(`${label}不能是符号链接、联接或路径别名: ${directory}`)
  }
}

async function requireCanonicalDirectory(directory, label) {
  let info
  try {
    info = await lstat(directory)
  } catch (error) {
    throw new Error(`${label}无法检查: ${directory}`, { cause: error })
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label}不是普通目录: ${directory}`)
  }
  const actual = await realpath(directory)
  if (!samePath(actual, directory)) {
    throw new Error(`${label}不能是符号链接、联接或路径别名: ${directory}`)
  }
}

function samePath(left, right) {
  const normalizedLeft = path.normalize(path.resolve(left))
  const normalizedRight = path.normalize(path.resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

async function requireRegularFile(filePath, label) {
  let info
  try {
    info = await stat(filePath)
  } catch (error) {
    throw new Error(`${label}不存在: ${filePath}`, { cause: error })
  }
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`${label}不是有效文件: ${filePath}`)
  }
}

async function collectFiles(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.shift()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isFile()) {
        files.push(entryPath)
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push(entryPath)
      }
    }
  }
  return files
}

function appendNoProxy(value, host) {
  const items = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!items.includes(host)) {
    items.push(host)
  }
  return items.join(',')
}

function spawnAndWait(executable, argumentsList, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      ...options,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    })
    child.once('error', (error) => {
      reject(new Error(`无法启动模拟构建命令: ${error.message}`, {
        cause: error,
      }))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        signal
          ? `模拟构建命令被信号 ${signal} 终止`
          : `模拟构建命令失败，退出码: ${code ?? 'unknown'}`,
      ))
    })
  })
}

async function main() {
  const result = await buildUpdateSimulationFixtures()
  console.log('已生成隔离的本地更新模拟 fixture:')
  console.log(JSON.stringify(result.descriptor, null, 2))
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
