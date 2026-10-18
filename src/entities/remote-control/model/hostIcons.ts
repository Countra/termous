import type { HostIcon, HostIconRequest } from '@termous/remote-protocol'

const maxIconBytes = 5 * 1024 * 1024
const maxCacheBytes = 32 * 1024 * 1024
const chunkBytes = 16 * 1024
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon'])

// 缓存限定在一个远控连接内，图标请求串行执行，给终端和文件操作保留请求额度。
export class RemoteHostIcons {
  private cache = new Map<string, Blob>()
  private pending = new Map<string, Promise<Blob>>()
  private queued: Promise<void> = Promise.resolve()
  private bytes = 0
  private closed = false

  constructor(private read: (input: Pick<HostIconRequest, 'hostId' | 'iconId' | 'offset'>) => Promise<HostIcon>) {}

  load(hostId: string, iconId: string): Promise<Blob> {
    if (this.closed || !hostId || !iconId) return Promise.reject(new Error('remote_host_icon_unavailable'))
    const key = JSON.stringify([hostId, iconId])
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve(cached)
    }
    const pending = this.pending.get(key)
    if (pending) return pending
    if (this.pending.size >= 256) return Promise.reject(Object.assign(new Error('remote_capacity_exceeded'), { code: 'remote_capacity_exceeded' }))
    const result = this.queued.then(() => this.fetch(hostId, iconId)).then(blob => {
      this.assertOpen()
      while (this.bytes + blob.size > maxCacheBytes || this.cache.size >= 256) {
        const first = this.cache.entries().next().value
        if (!first) break
        this.cache.delete(first[0])
        this.bytes -= first[1].size
      }
      this.cache.set(key, blob)
      this.bytes += blob.size
      return blob
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, result)
    this.queued = result.then(() => undefined, () => undefined)
    return result
  }

  private assertOpen() {
    if (this.closed) throw new Error('remote_disconnected')
  }

  private async fetch(hostId: string, iconId: string): Promise<Blob> {
    let offset = 0, total = 0, mime = ''
    const parts: ArrayBuffer[] = []
    do {
      this.assertOpen()
      const chunk = await this.read({ hostId, iconId, offset })
      this.assertOpen()
      if (chunk.iconId !== iconId || chunk.offset !== offset || chunk.totalBytes <= 0 || chunk.totalBytes > maxIconBytes ||
          !mimeTypes.has(chunk.mimeType) || (offset > 0 && (chunk.totalBytes !== total || chunk.mimeType !== mime)) ||
          chunk.data.length !== Math.min(chunkBytes, chunk.totalBytes - offset)) {
        throw new Error('remote_host_icon_invalid')
      }
      total = chunk.totalBytes
      mime = chunk.mimeType
      parts.push(Uint8Array.from(chunk.data).buffer)
      offset += chunk.data.length
    } while (offset < total)
    return new Blob(parts, { type: mime })
  }

  dispose() {
    this.closed = true
    this.cache.clear()
    this.pending.clear()
    this.bytes = 0
  }
}
