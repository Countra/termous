import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { BigIntStats } from 'node:fs'
import type { WorkflowFileErrorDetails } from '#common/contracts'

export const exchangeLimits = { manifest: 2 * 1024 ** 2, image: 8 * 1024 ** 2, content: 128 * 1024 ** 2, body: 130 * 1024 ** 2, assets: 768 }
export const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
export const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs

export class ExchangeFailure extends Error {
  readonly code: string
  readonly status: number
  readonly details?: WorkflowFileErrorDetails
  constructor(code: string, status = 0, message = code, details?: WorkflowFileErrorDetails) { super(message); this.code = code; this.status = status; this.details = details }
}

export async function selectedRoot(selected: string) {
  const root = await realpath(path.dirname(selected))
  return { root, file: path.join(root, path.basename(selected)) }
}
export async function openOrdinary(root: string, file: string, limit: number) {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new ExchangeFailure('workflow_exchange_unsafe_path')
  let current = root
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment)
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current)) throw new ExchangeFailure('workflow_exchange_unsafe_path')
  }
  const before = await lstat(file, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > BigInt(limit) || !samePath(await realpath(file), file)) throw new ExchangeFailure('workflow_exchange_unsafe_file')
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat({ bigint: true })
    if (!sameFile(info, before)) throw new ExchangeFailure('workflow_exchange_source_changed')
    const verify = async () => {
      const after = await lstat(file, { bigint: true })
      if (!after.isFile() || after.isSymbolicLink() || !sameFile(info, after) || !sameFile(info, await handle.stat({ bigint: true }))
        || !samePath(await realpath(file), file)) throw new ExchangeFailure('workflow_exchange_source_changed')
    }
    return { handle, size: Number(info.size), identity: info, verify }
  } catch (error) { await handle.close(); throw error }
}
export async function writeChunk(handle: FileHandle, data: Uint8Array) {
  let offset = 0
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset)
    if (bytesWritten <= 0) throw new ExchangeFailure('workflow_exchange_short_write')
    offset += bytesWritten
  }
}
