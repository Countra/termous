import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { SkillInstallClient, SkillInstallError } from '#common/contracts'

export class SkillInstallFailure extends Error {
  readonly code: SkillInstallError
  constructor(code: SkillInstallError) { super(code); this.code = code }
}

export function isSkillInstallClient(value: unknown): value is SkillInstallClient {
  return value === 'codex' || value === 'claude-code' || value === 'custom'
}

export function resolveSkillInstallDirectory(base: string, client: SkillInstallClient) {
  return client === 'custom' ? base : path.join(base, client === 'codex' ? '.agents' : '.claude', 'skills')
}

export async function entryStat(target: string) {
  try { return await lstat(target, { bigint: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function checkDirectory(directory: string) {
  const info = await entryStat(directory)
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new SkillInstallFailure('unsafe_path')
  return info
}

// 用户选中的根目录可以通过系统别名访问，附加的客户端目录则不得沿符号链接写出根目录。
export async function canonicalBase(directory: string) {
  if (!path.isAbsolute(directory) || directory.includes('\0')) throw new SkillInstallFailure('invalid_directory')
  const resolved = await realpath(directory)
  if (!await checkDirectory(resolved)) throw new SkillInstallFailure('invalid_directory')
  return resolved
}

export async function prepareTarget(base: string, target: string, create: boolean) {
  if (await realpath(base) !== base || !await checkDirectory(base)) throw new SkillInstallFailure('target_changed')
  let current = base
  const relative = path.relative(base, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new SkillInstallFailure('unsafe_path')
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (create) {
      try { await mkdir(current) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await checkDirectory(current)
  }
}

export function pathsOverlap(first: string, second: string) {
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }
  return within(first, second) || within(second, first)
}

export function skillInstallError(error: unknown): SkillInstallError {
  if (error instanceof SkillInstallFailure) return error.code
  switch ((error as NodeJS.ErrnoException | null)?.code) {
    case 'EACCES': case 'EPERM': return 'permission_denied'
    case 'ENOSPC': case 'EDQUOT': return 'disk_full'
    case 'ENOENT': case 'ENOTDIR': return 'invalid_directory'
    default: return 'io_error'
  }
}
