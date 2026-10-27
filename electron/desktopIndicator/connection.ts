import WebSocket from 'ws'
import { isDesktopControlSnapshot, type AppConfig, type DesktopControlReclaim, type DesktopControlSnapshot } from '#common/contracts'

interface Options {
  config(): Promise<AppConfig>
  snapshot(value: DesktopControlSnapshot | null): void
  warn(code: string): void
}
export class DesktopIndicatorConnection {
  private socket?: WebSocket
  private retry?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setTimeout>
  private config?: AppConfig
  private stopped = false
  private starting = false
  private readonly options: Options
  constructor(options: Options) { this.options = options }

  async start() {
    if (this.stopped || this.starting || this.socket) return
    this.starting = true
    try {
      const config = await this.options.config()
      if (this.stopped) return
      this.config = config
      const url = new URL('/api/v1/desktop-controls/events', config.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url, { headers: { 'X-Termous-Token': config.apiToken }, maxPayload: 1024 * 1024, handshakeTimeout: 10_000, followRedirects: false })
      this.socket = ws
      const disconnect = () => {
        if (this.socket !== ws) return
        this.socket = undefined
        clearTimeout(this.watchdog)
        this.options.snapshot(null)
        ws.terminate()
        this.scheduleRetry()
      }
      const alive = () => {
        if (this.stopped || this.socket !== ws) return
        clearTimeout(this.watchdog)
        this.watchdog = setTimeout(disconnect, 35_000)
      }
      ws.on('open', alive)
      ws.on('ping', alive)
      ws.on('message', (raw, binary) => {
        if (this.stopped || this.socket !== ws) return
        try {
          const value: unknown = binary ? null : JSON.parse(raw.toString())
          if (!isDesktopControlSnapshot(value)) throw new Error('desktop_indicator_invalid_snapshot')
          alive()
          this.options.snapshot(value)
        } catch {
          this.options.warn('desktop_indicator_snapshot_failed')
          disconnect()
        }
      })
      ws.on('error', () => {
        if (this.stopped || this.socket !== ws) return
        this.options.warn('desktop_indicator_connection_failed')
        disconnect()
      })
      ws.on('close', disconnect)
    } catch {
      this.options.warn('desktop_indicator_start_failed')
      this.options.snapshot(null)
      this.scheduleRetry()
    } finally { this.starting = false }
  }
  private scheduleRetry() {
    clearTimeout(this.retry)
    if (!this.stopped) this.retry = setTimeout(() => { void this.start() }, 2000)
  }
  async reclaim(request: DesktopControlReclaim) {
    if (this.stopped || !this.config || this.socket?.readyState !== WebSocket.OPEN) throw new Error('desktop_indicator_disconnected')
    const response = await fetch(new URL('/api/v1/desktop-controls/reclaim', this.config.apiBaseUrl), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { 'X-Termous-Token': this.config.apiToken, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error('desktop_reclaim_failed')
  }
  close() {
    this.stopped = true
    clearTimeout(this.retry)
    clearTimeout(this.watchdog)
    this.socket?.terminate()
    this.socket = undefined
    this.options.snapshot(null)
  }
}
