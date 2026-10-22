import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 仅规范化测试自建目录，消除 macOS /var 和 Windows 短路径别名；业务输入仍由各自的路径门禁校验。
export async function createCanonicalTempDirectory(prefix: string, parentDirectory = tmpdir()) {
  const canonicalParent = await realpath(parentDirectory)
  return realpath(await mkdtemp(path.join(canonicalParent, prefix)))
}

export function createCanonicalTempDirectorySync(prefix: string, parentDirectory = tmpdir()) {
  const canonicalParent = realpathSync.native(parentDirectory)
  return realpathSync.native(mkdtempSync(path.join(canonicalParent, prefix)))
}
