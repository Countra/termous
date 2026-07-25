import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const targetVersion = '0.0.2'

export interface ValidatedSimulationAsset {
  name: string
  size: number
  sha512: string
}

export async function validateUpdateSimulationInputs(
  feedRootValue: string,
  resourcesPath: string,
  expectedFeedURL: string,
): Promise<ValidatedSimulationAsset> {
  const config = parseYaml(
    await readFile(path.join(resourcesPath, 'app-update.yml'), 'utf8'),
  )
  if (
    config?.provider !== 'generic'
    || config?.url !== expectedFeedURL
    || config?.useMultipleRangeRequest !== false
    || config?.updaterCacheDirName !== 'termous-update-simulation-updater'
  ) {
    throw new Error('隔离包内的 generic 更新源配置无效')
  }

  const feedRoot = await requireCanonicalDirectory(feedRootValue)
  const manifestPath = await requireDirectRegularFile(
    feedRoot,
    'latest.yml',
    '候选更新清单',
  )
  const manifest = parseYaml(await readFile(manifestPath, 'utf8'))
  if (
    manifest?.version !== targetVersion
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 1
  ) {
    throw new Error('运行时更新清单不是预期的 0.0.2 单载荷')
  }
  const entry = manifest.files[0]
  const name = typeof entry?.url === 'string' ? entry.url : ''
  if (
    !isDirectInstallerName(name)
    || manifest.path !== name
    || typeof entry.sha512 !== 'string'
    || entry.sha512 !== manifest.sha512
    || !isSHA512(entry.sha512)
    || !Number.isSafeInteger(entry.size)
    || entry.size <= 0
  ) {
    throw new Error('运行时更新清单包含无效或越界的安装器描述')
  }

  const installerPath = await requireDirectRegularFile(
    feedRoot,
    name,
    '候选安装器',
  )
  await requireDirectRegularFile(
    feedRoot,
    `${name}.blockmap`,
    '候选安装器 blockmap',
  )
  const info = await stat(installerPath)
  const digest = await hashFile(installerPath)
  if (info.size !== entry.size || digest !== entry.sha512) {
    throw new Error('运行时候选安装器与更新清单不一致')
  }
  return {
    name,
    size: info.size,
    sha512: digest,
  }
}

async function requireCanonicalDirectory(value: string) {
  const resolved = await realpath(value)
  if (!samePath(resolved, value)) {
    throw new Error('模拟更新源目录不能是符号链接或路径别名')
  }
  const info = await stat(resolved)
  if (!info.isDirectory()) {
    throw new Error('模拟更新源不是目录')
  }
  return resolved
}

function samePath(left: string, right: string) {
  const normalizedLeft = path.normalize(left)
  const normalizedRight = path.normalize(path.resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

async function requireDirectRegularFile(
  root: string,
  name: string,
  label: string,
) {
  if (
    !name
    || name !== path.posix.basename(name)
    || name !== path.win32.basename(name)
  ) {
    throw new Error(`${label}名称越界`)
  }
  const candidate = path.join(root, name)
  const linkInfo = await lstat(candidate)
  if (!linkInfo.isFile() || linkInfo.isSymbolicLink() || linkInfo.size <= 0) {
    throw new Error(`${label}不是有效普通文件`)
  }
  const resolved = await realpath(candidate)
  if (path.dirname(resolved) !== root) {
    throw new Error(`${label}不在更新源根目录内`)
  }
  return resolved
}

function isDirectInstallerName(value: string) {
  return (
    value.length <= 240
    && /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i.test(value)
    && value === path.posix.basename(value)
    && value === path.win32.basename(value)
  )
}

function isSHA512(value: string) {
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.byteLength === 64 && decoded.toString('base64') === value
  } catch {
    return false
  }
}

async function hashFile(filePath: string) {
  const digest = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk)
  }
  return digest.digest('base64')
}
