import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import path from 'node:path'
import type { BigIntStats } from 'node:fs'
import { importAssets } from './resources.ts'
import { ExchangeCore } from './core.ts'
import { sameFile, exchangeLimits, ExchangeFailure, openOrdinary, selectedRoot } from './files.ts'

export async function importFile(core: ExchangeCore, selected: string, signal: AbortSignal, progress: (bytes: number, total: number) => void): Promise<string> {
  const { root, file } = await selectedRoot(selected)
  const zip = path.extname(file).toLowerCase() === '.zip'
  if (!zip && path.extname(file).toLowerCase() !== '.json') throw new ExchangeFailure('desktop_workflow_exchange_invalid')
  const source = await openOrdinary(root, file, zip ? exchangeLimits.body : exchangeLimits.manifest)
  let manifest: Buffer | undefined
  const images: { path: string; size: number; identity: BigIntStats }[] = []
  try {
    if (!zip) {
      // 固定最大读取量，避免文件在 stat 后持续增长导致无界分配。
      manifest = Buffer.alloc(source.size + 1)
      let offset = 0
      while (offset < manifest.length) {
        const { bytesRead } = await source.handle.read(manifest, offset, manifest.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== source.size) throw new ExchangeFailure('workflow_exchange_source_changed')
      manifest = manifest.subarray(0, offset)
      await source.verify()
      const declarations = importAssets(JSON.parse(manifest.toString('utf8')))
      let total = source.size
      for (const declaration of declarations) {
        signal.throwIfAborted()
        const opened = await openOrdinary(root, path.join(root, declaration.path), exchangeLimits.image)
        try {
          await opened.verify()
          total += opened.size
          if (total > exchangeLimits.content) throw new ExchangeFailure('desktop_workflow_exchange_limit')
          images.push({ path: declaration.path, size: opened.size, identity: opened.identity })
        } finally { await opened.handle.close() }
      }
    }
  } catch (error) { await source.handle.close(); throw error }
  const boundary = `termous-workflow-${randomBytes(18).toString('hex')}`
  const total = source.size + images.reduce((sum, a) => sum + a.size, 0)
  if (!zip && total > exchangeLimits.content) { await source.handle.close(); throw new ExchangeFailure('desktop_workflow_exchange_limit') }
  let transferred = 0
  const header = (name: string, filename: string, type: string) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`)
  const fileChunks = async function* (filename: string, size: number, limit: number, identity?: BigIntStats) {
    const opened = zip ? source : await openOrdinary(root, filename, limit)
    try {
      if (opened.size !== size || identity && !sameFile(identity, opened.identity)) throw new ExchangeFailure('workflow_exchange_source_changed')
      let received = 0
      for await (const chunk of opened.handle.createReadStream({ start: 0, end: size - 1, autoClose: false, signal })) {
        signal.throwIfAborted()
        received += chunk.length; transferred += chunk.length
        progress(transferred, total)
        yield chunk
      }
      if (received !== size) throw new ExchangeFailure('workflow_exchange_source_changed')
      await opened.verify()
    } finally { if (opened !== source) await opened.handle.close() }
  }
  const upload = async function* () {
    if (zip) {
      yield header('bundle', 'workflow.zip', 'application/zip')
      yield* fileChunks(file, source.size, exchangeLimits.body)
      yield Buffer.from('\r\n')
    } else {
      yield header('manifest', 'workflow.json', 'application/json')
      yield manifest!; transferred += manifest!.length; progress(transferred, total)
      yield Buffer.from('\r\n')
      for (const a of images) {
        yield header('assets', path.posix.basename(a.path), 'image/png')
        yield* fileChunks(path.join(root, a.path), a.size, exchangeLimits.image, a.identity)
        yield Buffer.from('\r\n')
      }
    }
    yield Buffer.from(`--${boundary}--\r\n`)
  }
  const body = Readable.from(upload())
  try {
    const response = await core.request('imports', {
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: body as unknown as BodyInit, duplex: 'half', signal,
    } as RequestInit)
    const result = await response.json() as { id?: unknown }
    if (typeof result.id !== 'string' || !/^workflow_import_[a-zA-Z0-9_-]+$/.test(result.id)) throw new ExchangeFailure('workflow_exchange_response_invalid')
    return result.id
  } finally {
    body.destroy()
    await finished(body, { cleanup: true }).catch(error => {
      if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !signal.aborted) console.warn('[termous:workflow] 上传流已终止')
    })
    await source.handle.close()
  }
}
