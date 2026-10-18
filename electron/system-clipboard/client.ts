import WebSocket from 'ws'
import { decodeSystemClipboardCapabilities, decodeSystemClipboardEvent, type AppConfig } from '#common/contracts'
import { ClipboardCapabilitiesState } from './state.ts'

// 每个 Core 连接只有一条订阅；订阅重同步后读取完整快照，迟到响应由代次丢弃。
export class ClipboardCapabilitiesClient {
  readonly state = new ClipboardCapabilitiesState()
  private epoch = 0
  private socket?: WebSocket
  private request?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private delay = 1000
  private readonly config: () => Promise<AppConfig>
  constructor(config: () => Promise<AppConfig>) { this.config = config }
  start() { if (!this.running) { this.running = true; void this.connect() } }
  stop() {
    this.running = false
    this.epoch++
    clearTimeout(this.timer)
    this.request?.abort()
    this.socket?.terminate()
    this.socket = undefined
    this.state.offline()
  }
  private async connect() {
    const epoch = ++this.epoch
    try {
      const config = await this.config()
      if (!this.running || epoch !== this.epoch) return
      const url = new URL('/api/v1/system-file-clipboard/events', config.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url, { headers: { 'X-Termous-Token': config.apiToken }, followRedirects: false, maxPayload: 16 * 1024, handshakeTimeout: 8000, perMessageDeflate: false })
      this.socket = socket
      socket.on('error', () => socket.terminate())
      socket.on('close', () => this.disconnected(epoch))
      let target = { instance: '', revision: 0 }, refreshing = false, dirty = false
      const refresh = async () => {
        dirty = true
        if (refreshing) return
        refreshing = true
        try {
          while (dirty && epoch === this.epoch && this.running) {
            dirty = false
            const expected = { ...target }
            const abort = new AbortController()
            this.request = abort
            const response = await fetch(new URL('/api/v1/system-file-clipboard/capabilities', config.apiBaseUrl), {
              redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
              headers: { 'X-Termous-Token': config.apiToken, 'Cache-Control': 'no-store' },
            })
            if (!response.ok) throw new Error('SYSTEM_CLIPBOARD_UNAVAILABLE')
            const snapshot = decodeSystemClipboardCapabilities(await response.json())
            if (epoch !== this.epoch || !this.running) return
            if (target.instance !== expected.instance) throw new Error('SYSTEM_CLIPBOARD_INSTANCE_CHANGED')
            if (snapshot.revision < expected.revision) throw new Error('SYSTEM_CLIPBOARD_STALE_RESPONSE')
            if (target.revision > snapshot.revision) { dirty = true; continue }
            if (snapshot.instance_id !== target.instance) throw new Error('SYSTEM_CLIPBOARD_INSTANCE_CHANGED')
            this.state.accept(snapshot)
            this.delay = 1000
          }
        } catch { if (epoch === this.epoch) socket.terminate() }
        finally { refreshing = false }
      }
      socket.on('message', data => {
        if (epoch !== this.epoch || !this.running) return
        try {
          const event = decodeSystemClipboardEvent(JSON.parse(data.toString()))
          if (target.instance && target.instance !== event.instance_id) { socket.terminate(); return }
          if (target.revision > event.revision) return
          target = { instance: event.instance_id, revision: event.revision }
          void refresh()
        } catch { socket.terminate() }
      })
    } catch { this.disconnected(epoch) }
  }
  private disconnected(epoch: number) {
    if (epoch !== this.epoch || !this.running) return
    this.epoch++
    this.request?.abort()
    this.state.offline()
    this.timer = setTimeout(() => void this.connect(), this.delay)
    this.delay = Math.min(this.delay * 2, 30_000)
  }
}
