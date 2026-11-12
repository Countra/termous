import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowExportLayout } from '#common/contracts'
import { exchangeLimits, ExchangeFailure, sameFile, writeChunk } from './files.ts'
import { ExchangeCore } from './core.ts'
import { assetIndex } from './resources.ts'

export async function download(core: ExchangeCore, resource: string, target: string, size: number, signal: AbortSignal, progress: (bytes: number) => void, hash?: string) {
  const response = await core.request(resource, { signal })
  if (!response.body || Number(response.headers.get('Content-Length')) !== size) {
    await response.body?.cancel().catch(() => console.warn('[termous:workflow] Failed to close invalid download response'))
    throw new ExchangeFailure('workflow_exchange_response_invalid')
  }
  const reader = response.body.getReader(); const digest = createHash('sha256'); let bytes = 0
  let file: Awaited<ReturnType<typeof open>> | undefined
  let failure: unknown
  try {
    file = await open(target, 'wx', 0o600)
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      signal.throwIfAborted(); bytes += value.length
      if (bytes > size) throw new ExchangeFailure('workflow_exchange_response_invalid')
      await writeChunk(file, value); digest.update(value); progress(value.length)
    }
    if (bytes !== size || hash && digest.digest('hex') !== hash) throw new ExchangeFailure('workflow_exchange_response_invalid')
    await file.sync()
  } catch (error) { failure = error }
  finally {
    try { await reader.cancel() } catch (error) { failure ??= error }
    reader.releaseLock()
    try { await file?.close() } catch (error) { failure ??= error }
  }
  if (failure) throw failure
}

export async function exportFile(core: ExchangeCore, script: string, version: number, layout: WorkflowExportLayout, selected: string, signal: AbortSignal, progress: (bytes: number, total: number, publishing?: boolean) => void) {
  const parent = await realpath(path.dirname(selected)); const destination = path.join(parent, path.basename(selected))
  const existing = await lstat(destination, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (existing && (layout === 'directory' || existing.isSymbolicLink() || !existing.isFile())) throw new ExchangeFailure('workflow_exchange_target_exists')
  const response = await core.request(`${encodeURIComponent(script)}/versions/${version}/exports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: layout === 'zip' ? 'zip' : 'json' }), signal,
  })
  const snapshot = await response.json() as { id: string; content_length: number; content_type: string; format: string; assets: unknown[] }
  if (typeof snapshot.id !== 'string' || !/^workflow_export_[a-zA-Z0-9_-]+$/.test(snapshot.id)) throw new ExchangeFailure('workflow_exchange_response_invalid')
  let temporary: string | undefined
  try {
    if (snapshot.format !== (layout === 'zip' ? 'zip' : 'json') || snapshot.content_type !== (layout === 'zip' ? 'application/zip' : 'application/json')) throw new ExchangeFailure('workflow_exchange_response_invalid')
    const assets = assetIndex(snapshot)
    if (!Number.isSafeInteger(snapshot.content_length) || snapshot.content_length < 1 || snapshot.content_length > exchangeLimits.body) throw new ExchangeFailure('workflow_exchange_response_invalid')
    if (layout === 'json' && assets.length) throw new ExchangeFailure('workflow_exchange_assets_require_directory')
    const base = `exports/${encodeURIComponent(snapshot.id)}`
    const total = snapshot.content_length + (layout === 'directory' ? assets.reduce((sum, a) => sum + a.size, 0) : 0)
    let transferred = 0
    const advance = (bytes: number) => { transferred += bytes; progress(transferred, total) }
    if (layout === 'directory') {
      temporary = await mkdtemp(path.join(parent, '.workflow-export-'))
      if (assets.length) await mkdir(path.join(temporary, 'assets'), { mode: 0o700 })
      for (const asset of assets) await download(core, `${base}/assets/${asset.sha256}`, path.join(temporary, asset.path), asset.size, signal, advance, asset.sha256)
      await download(core, `${base}/content`, path.join(temporary, 'workflow.json'), snapshot.content_length, signal, advance)
      if (await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new ExchangeFailure('workflow_exchange_target_exists')
    } else {
      temporary = path.join(parent, `.workflow-export-${randomUUID()}.partial`)
      await download(core, `${base}/content`, temporary, snapshot.content_length, signal, advance)
    }
    signal.throwIfAborted(); progress(transferred, total, true)
    const latest = await lstat(destination, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (existing ? !latest || !sameFile(existing, latest) : latest) throw new ExchangeFailure('workflow_exchange_target_exists')
    await rename(temporary, destination); temporary = undefined
    return { file_name: path.basename(destination), directory: layout === 'directory' ? destination : parent }
  } finally {
    if (temporary) await rm(temporary, { recursive: layout === 'directory', force: true }).catch(() => console.warn('[termous:workflow] Failed to clean up temporary export files'))
    await core.release('exports', snapshot.id).catch(() => console.warn('[termous:workflow] Failed to release export snapshot; it will expire automatically'))
  }
}
