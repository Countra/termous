import type { RemoteCore } from './core'
import { RemoteCoreError, validId } from './core'

// 只接受文件选择器提供的字节或被控端内容标识，Renderer 无法指定本机路径与 HTTP 地址。
export class RemoteAgentContent {
  private active = 0
  private core: RemoteCore
  constructor(core: RemoteCore) { this.core = core }

  private async transfer(base: string, generation: string, content?: string, bytes?: Uint8Array, mime?: string) {
    if (this.active >= 2) throw new RemoteCoreError('remote_capacity_exceeded')
    this.active++
    try {
      const config = await this.core.config()
      const query = new URLSearchParams({ generation, ...(content ? { purpose: 'attachment' } : { mime: mime! }) })
      const url = new URL(`/api/v1${base}/agent-content${content ? `/${encodeURIComponent(content)}` : ''}?${query}`, config.apiBaseUrl)
      const response = await fetch(url, { method: content ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
        headers: { 'X-Termous-Token': config.apiToken, 'Content-Type': 'application/octet-stream' }, body: bytes as BodyInit | undefined })
      if (!response.ok) throw new RemoteCoreError('remote_agent_content_failed')
      if (!content) {
        const value: unknown = await response.json()
        if (!value || typeof value !== 'object' || !('id' in value) || !validId(value.id)) throw new RemoteCoreError('remote_invalid')
        return { id: value.id }
      }
      const reader = response.body?.getReader()
      if (!reader) throw new RemoteCoreError('remote_invalid')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 10 << 20) throw new RemoteCoreError('remote_capacity_exceeded')
          chunks.push(value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      return Buffer.concat(chunks, size)
    } catch (error) {
      if (error instanceof RemoteCoreError) throw error
      throw new RemoteCoreError('remote_agent_content_failed')
    } finally { this.active-- }
  }

  async upload(base: string, generation: string, data: unknown, mime: unknown) {
    // 这里只验证传输合同；JSON、Markdown 等文本与图片仍由被控端原附件服务校验内容。
    if (!(data instanceof Uint8Array) || !data.length || data.length > 10 << 20 || typeof mime !== 'string' || mime.length > 128 || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mime)) throw new RemoteCoreError('remote_invalid_request')
    return await this.transfer(base, generation, undefined, data, mime) as { id: string }
  }
  async download(base: string, generation: string, id: unknown) {
    if (!validId(id)) throw new RemoteCoreError('remote_invalid_request')
    return await this.transfer(base, generation, id) as Uint8Array
  }
}
