import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

const allowedRootEntries = new Set([
  'acceptance-report.json',
  'user-data',
  'session-data',
  'crash-dumps',
  'logs',
  'cache-root',
])
const reportTemporaryNamePattern =
  /^acceptance-report\.json\.tmp-[1-9]\d{0,15}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function prepareUpdateSimulationDirectories(rootValue: string) {
  const root = path.resolve(rootValue)
  requireCanonicalDirectory(root, '模拟运行根目录')
  const staleReportTemporaryPaths: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const isReportTemporary = reportTemporaryNamePattern.test(entry.name)
    if (
      (!allowedRootEntries.has(entry.name) && !isReportTemporary)
      || entry.isSymbolicLink()
    ) {
      throw new Error(`模拟运行根目录包含未知条目: ${entry.name}`)
    }
    if (isReportTemporary) {
      if (!entry.isFile()) {
        throw new Error('模拟验收报告临时条目不是普通文件')
      }
      staleReportTemporaryPaths.push(path.join(root, entry.name))
    }
    if (
      entry.name === 'acceptance-report.json'
      && !entry.isFile()
    ) {
      throw new Error('模拟验收报告不是普通文件')
    }
  }

  const directories = {
    root,
    userData: path.join(root, 'user-data'),
    sessionData: path.join(root, 'session-data'),
    crashDumps: path.join(root, 'crash-dumps'),
    logs: path.join(root, 'logs'),
    cacheRoot: path.join(root, 'cache-root'),
  }
  for (const [name, directory] of Object.entries(directories)) {
    if (name !== 'root') {
      requireCanonicalDirectory(directory, `模拟隔离目录 ${name}`)
    }
  }
  for (const temporaryPath of staleReportTemporaryPaths) {
    rmSync(temporaryPath, { force: true })
  }
  rmSync(path.join(root, 'acceptance-report.json'), { force: true })
  // 下载缓存每轮重新建立，避免上一轮完整载荷绕过断流、哈希和取消场景。
  rmSync(directories.cacheRoot, { force: true, recursive: true })
  requireCanonicalDirectory(directories.cacheRoot, '模拟隔离目录 cacheRoot')
  return directories
}

function requireCanonicalDirectory(directory: string, label: string) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }
  const linkInfo = lstatSync(directory)
  if (!linkInfo.isDirectory() || linkInfo.isSymbolicLink()) {
    throw new Error(`${label}不是普通目录`)
  }
  const actual = realpathSync.native(directory)
  if (!samePath(actual, directory)) {
    throw new Error(`${label}不能是符号链接、联接或路径别名`)
  }
}

function samePath(left: string, right: string) {
  const normalizedLeft = path.normalize(left)
  const normalizedRight = path.normalize(path.resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
