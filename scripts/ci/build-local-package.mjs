import { spawn } from 'node:child_process'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

import {
  hashRegularFile,
  requireReleaseVersion,
  validateUpdateManifest,
} from './release-manifest-contract.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptPath)
const defaultWebDirectory = path.resolve(scriptDirectory, '..', '..')

export const publishCredentialNames = Object.freeze([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_RELEASE_TOKEN',
  'GITLAB_TOKEN',
  'BITBUCKET_TOKEN',
  'KEYGEN_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'DO_KEY',
  'DO_SECRET_KEY',
  'SNAPCRAFT_STORE_CREDENTIALS',
])

export function parseLocalPackageArguments(argv) {
  const options = {
    verifyOnly: false,
    outputDirectory: null,
    platform: process.platform,
    arch: process.arch,
    version: null,
    webDirectory: defaultWebDirectory,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--verify-only') {
      options.verifyOnly = true
      continue
    }
    if (argument === '--output') {
      options.outputDirectory = requireArgumentValue(argv, ++index, argument)
      continue
    }
    if (argument === '--platform') {
      options.platform = requireArgumentValue(argv, ++index, argument)
      continue
    }
    if (argument === '--arch') {
      options.arch = requireArgumentValue(argv, ++index, argument)
      continue
    }
    if (argument === '--version') {
      options.version = requireArgumentValue(argv, ++index, argument)
      continue
    }
    if (argument === '--web-dir') {
      options.webDirectory = requireArgumentValue(argv, ++index, argument)
      continue
    }
    throw new Error(`未知参数: ${argument}`)
  }

  return options
}

export function sanitizePublishEnvironment(input) {
  const output = { ...input }
  for (const name of publishCredentialNames) {
    delete output[name]
  }
  return output
}

export function createElectronBuilderArguments({
  platform,
  arch,
  outputDirectory,
  version,
  requireSigning = false,
}) {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const targetArguments = targetArgumentsFor(
    normalizedPlatform,
    normalizedArch,
  )

  return [
    'exec',
    'electron-builder',
    ...targetArguments,
    '--config',
    'electron-builder.json5',
    `--config.directories.output=${outputDirectory}`,
    `--config.extraMetadata.version=${version}`,
    ...(requireSigning ? ['--config.forceCodeSigning=true'] : []),
    '--publish',
    'never',
  ]
}

export async function validatePackageArtifacts({
  outputDirectory,
  platform,
  arch,
  version,
}) {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const normalizedVersion = normalizeVersion(version)
  const root = path.resolve(outputDirectory)
  await assertDirectory(root, '安装包输出目录')

  const expected = expectedArtifacts(
    normalizedPlatform,
    normalizedArch,
    normalizedVersion,
  )
  for (const fileName of expected.files) {
    await assertFile(path.join(root, fileName), `发布资产 ${fileName}`)
  }

  const manifestPath = path.join(root, expected.manifest)
  const manifest = await readYamlObject(manifestPath, expected.manifest)
  validateUpdateManifest(manifest, {
    arch: normalizedPlatform === 'darwin' ? normalizedArch : undefined,
    platform: releasePlatformFor(normalizedPlatform),
    source: expected.manifest,
    version: normalizedVersion,
  })
  await validateManifest(manifest, {
    outputDirectory: root,
    version: normalizedVersion,
    payloadNames: expected.payloads,
    name: expected.manifest,
  })

  const appUpdatePaths = await findNamedFiles(root, 'app-update.yml', 6)
  if (appUpdatePaths.length === 0) {
    throw new Error(`未找到包内 app-update.yml: ${root}`)
  }
  for (const appUpdatePath of appUpdatePaths) {
    const appUpdate = await readYamlObject(appUpdatePath, 'app-update.yml')
    validateAppUpdateProvider(appUpdate, appUpdatePath)
  }
  const coreName = normalizedPlatform === 'win32'
    ? 'termous-core.exe'
    : 'termous-core'
  const corePaths = await findNamedFiles(root, coreName, 8)
  if (corePaths.length === 0) {
    throw new Error(`未找到包内 ${coreName}: ${root}`)
  }
  for (const corePath of corePaths) {
    await assertFile(corePath, `包内 Core ${coreName}`)
  }

  return {
    appUpdatePaths,
    corePaths,
    manifestPath,
    files: expected.files.map((fileName) => path.join(root, fileName)),
  }
}

export async function runLocalPackage(
  options,
  dependencies = {},
) {
  const webDirectory = path.resolve(options.webDirectory ?? defaultWebDirectory)
  const packageJson = await readPackageJson(webDirectory)
  const version = normalizeVersion(options.version ?? packageJson.version)
  const platform = normalizePlatform(options.platform ?? process.platform)
  const arch = normalizeArch(options.arch ?? process.arch)
  const outputDirectory = path.resolve(
    options.outputDirectory
      ?? path.join(webDirectory, 'release', version),
  )
  assertSafeOutputDirectory(outputDirectory, webDirectory)

  if (!options.verifyOnly) {
    await rm(outputDirectory, { force: true, recursive: true })
    const spawnProcess = dependencies.spawnProcess ?? spawnAndWait
    const environment = sanitizePublishEnvironment(process.env)
    environment.VITE_TERMOUS_APP_VERSION = version
    const builderArguments = createElectronBuilderArguments({
      platform,
      arch,
      outputDirectory,
      version,
      requireSigning: process.env.TERMOUS_REQUIRE_SIGNING === 'true',
    })
    const builderCli = path.join(
      webDirectory,
      'node_modules',
      'electron-builder',
      'cli.js',
    )
    await spawnProcess(process.execPath, [builderCli, ...builderArguments.slice(2)], {
      cwd: webDirectory,
      env: environment,
    })
  }

  return validatePackageArtifacts({
    outputDirectory,
    platform,
    arch,
    version,
  })
}

function requireArgumentValue(argv, index, name) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 缺少参数值`)
  }
  return value
}

function normalizePlatform(value) {
  const aliases = {
    darwin: 'darwin',
    macos: 'darwin',
    linux: 'linux',
    win32: 'win32',
    windows: 'win32',
  }
  const normalized = aliases[String(value ?? '').toLowerCase()]
  if (!normalized) {
    throw new Error(`不支持的打包平台: ${value}`)
  }
  return normalized
}

function normalizeArch(value) {
  const aliases = {
    amd64: 'x64',
    arm64: 'arm64',
    x64: 'x64',
    x86_64: 'x64',
  }
  const normalized = aliases[String(value ?? '').toLowerCase()]
  if (!normalized) {
    throw new Error(`不支持的打包架构: ${value}`)
  }
  return normalized
}

function releasePlatformFor(platform) {
  if (platform === 'win32') {
    return 'windows'
  }
  if (platform === 'darwin') {
    return 'macos'
  }
  return 'linux'
}

function normalizeVersion(value) {
  const version = String(value ?? '')
  return requireReleaseVersion(version, '应用版本')
}

function assertSafeOutputDirectory(outputDirectory, webDirectory) {
  const workspaceDirectory = path.dirname(webDirectory)
  const roots = [
    path.join(webDirectory, 'release'),
    path.join(workspaceDirectory, 'build'),
  ]
  if (!roots.some((root) => isStrictChildPath(outputDirectory, root))) {
    throw new Error(
      `打包输出目录必须位于 web/release 或 workspace/build 内: ${outputDirectory}`,
    )
  }
}

function isStrictChildPath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative.length > 0
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  )
}

function targetArgumentsFor(platform, arch) {
  if (platform === 'win32' && arch === 'x64') {
    return ['--win', 'nsis', '--x64']
  }
  if (platform === 'linux' && arch === 'x64') {
    return ['--linux', 'AppImage', '--x64']
  }
  if (platform === 'darwin') {
    return ['--mac', 'dmg', 'zip', arch === 'arm64' ? '--arm64' : '--x64']
  }
  throw new Error(`当前打包目标不受支持: ${platform}/${arch}`)
}

function expectedArtifacts(platform, arch, version) {
  const prefix = `Termous-${version}`
  if (platform === 'win32') {
    const payload = `${prefix}-windows-${arch}-setup.exe`
    return {
      manifest: 'latest.yml',
      payloads: [payload],
      files: [payload, `${payload}.blockmap`, 'latest.yml'],
    }
  }
  if (platform === 'linux') {
    const payload = `${prefix}-linux-${arch}.AppImage`
    return {
      manifest: 'latest-linux.yml',
      payloads: [payload],
      files: [payload, 'latest-linux.yml'],
    }
  }
  const dmg = `${prefix}-macos-${arch}.dmg`
  const zip = `${prefix}-macos-${arch}.zip`
  return {
    manifest: 'latest-mac.yml',
    payloads: [zip, dmg],
    files: [dmg, zip, `${zip}.blockmap`, 'latest-mac.yml'],
  }
}

async function readPackageJson(webDirectory) {
  const packagePath = path.join(webDirectory, 'package.json')
  let content
  try {
    content = await readFile(packagePath, 'utf8')
  } catch (error) {
    throw new Error(`无法读取 package.json: ${packagePath}`, { cause: error })
  }
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`package.json 不是有效 JSON: ${packagePath}`, {
      cause: error,
    })
  }
}

async function assertDirectory(filePath, label) {
  let info
  try {
    info = await stat(filePath)
  } catch (error) {
    throw new Error(`${label}不存在: ${filePath}`, { cause: error })
  }
  if (!info.isDirectory()) {
    throw new Error(`${label}不是目录: ${filePath}`)
  }
}

async function assertFile(filePath, label) {
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

async function readYamlObject(filePath, label) {
  let value
  try {
    value = parseYaml(await readFile(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} 不是有效 YAML: ${filePath}`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 根节点必须是对象: ${filePath}`)
  }
  return value
}

async function validateManifest(manifest, expectation) {
  if (manifest.version !== expectation.version) {
    throw new Error(
      `${expectation.name} 版本不匹配: ${manifest.version ?? '<empty>'}`,
    )
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${expectation.name} 缺少 files`)
  }

  const files = new Map()
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${expectation.name} 包含无效文件条目`)
    }
    const url = String(entry.url ?? '')
    const sha512 = String(entry.sha512 ?? '')
    const size = Number(entry.size)
    if (
      !isSafeAssetName(url)
      || !sha512
      || !Number.isFinite(size)
      || size <= 0
    ) {
      throw new Error(`${expectation.name} 文件条目缺少 url/sha512/size`)
    }
    if (files.has(url)) {
      throw new Error(`${expectation.name} 包含重复文件: ${url}`)
    }
    files.set(url, entry)
  }

  for (const payloadName of expectation.payloadNames) {
    const entry = files.get(payloadName)
    if (!entry) {
      throw new Error(`${expectation.name} 未引用更新载荷: ${payloadName}`)
    }
    const digest = await hashRegularFile(
      path.join(expectation.outputDirectory, payloadName),
      payloadName,
    )
    if (entry.size !== digest.size || entry.sha512 !== digest.sha512) {
      throw new Error(
        `${expectation.name} 中 ${payloadName} 的 SHA512 或 size 错误`,
      )
    }
  }
}

function isSafeAssetName(value) {
  return (
    value.length > 0
    && value.length <= 255
    && value === path.posix.basename(value)
    && value === path.win32.basename(value)
    && value !== '.'
    && value !== '..'
    && !/[?#%]/.test(value)
  )
}

function validateAppUpdateProvider(value, filePath) {
  if (
    value.provider !== 'github'
    || value.owner !== 'Countra'
    || value.repo !== 'termous'
    || value.channel !== 'latest'
    || value.publishAutoUpdate !== true
  ) {
    throw new Error(`app-update.yml 更新源不正确: ${filePath}`)
  }
}

async function findNamedFiles(root, name, maxDepth) {
  const matches = []
  const pending = [{ directory: root, depth: 0 }]
  while (pending.length > 0) {
    const current = pending.shift()
    const entries = await readdir(current.directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current.directory, entry.name)
      if (entry.isFile() && entry.name === name) {
        matches.push(entryPath)
      } else if (
        entry.isDirectory()
        && !entry.isSymbolicLink()
        && current.depth < maxDepth
      ) {
        pending.push({
          directory: entryPath,
          depth: current.depth + 1,
        })
      }
    }
  }
  return matches
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
      reject(new Error(`无法启动 electron-builder: ${error.message}`, {
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
          ? `electron-builder 被信号 ${signal} 终止`
          : `electron-builder 失败，退出码: ${code ?? 'unknown'}`,
      ))
    })
  })
}

async function main() {
  const options = parseLocalPackageArguments(process.argv.slice(2))
  const result = await runLocalPackage(options)
  console.log('已验证应用更新打包产物:')
  for (const filePath of [...result.files, ...result.appUpdatePaths]) {
    console.log(`- ${filePath}`)
  }
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
