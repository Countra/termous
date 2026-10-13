import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import type { AppConfig, AppLanguage, AppTheme, DesktopAutomationBootstrap, DesktopAutomationHost } from '#common/contracts'

interface Options {
  config(): Promise<AppConfig>
  appearance(): { language: AppLanguage; theme: AppTheme }
  renderer: string
  preload: string
  devURL?: string
  warn(code: string): void
}
interface Entry { window: BrowserWindow; host: DesktopAutomationHost; url: string; bootstrap?: Promise<DesktopAutomationBootstrap>; credential: string }
interface Pending { hostID: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

export class DesktopAutomationRuntime {
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Pending>()
  private ws?: WebSocket
  private config?: AppConfig
  private sequence = 0
  private stopped = false
  private starting = false
  private retry?: ReturnType<typeof setTimeout>

  constructor(private readonly options: Options) {
    ipcMain.handle('desktop-automation:bootstrap', event => {
      const entry = this.own(event)
      entry.bootstrap ??= this.bootstrap(entry).catch(error => { this.fail(entry); throw error })
      return entry.bootstrap
    })
    ipcMain.handle('desktop-automation:credentials', async event => {
      const entry = this.own(event)
      const ticket = entry.credential
      entry.credential = ''
      if (!ticket) throw new Error('desktop_credentials_unavailable')
      return this.request(entry, 'credentials', { credential_ticket: ticket })
    })
    ipcMain.handle('desktop-automation:executor', async event => {
      const entry = this.own(event)
      const origin = new URL(entry.url).origin
      const ticket = await this.request<{ path: string; ticket: string }>(entry, 'executor', { origin })
      this.own(event)
      return { url: this.socketURL('/api/v1/remote-desktop-executor').toString(), ticket: ticket.ticket }
    })
    ipcMain.handle('desktop-automation:state', async (event, state: unknown) => {
      const entry = this.own(event)
      if (!['preparing', 'waiting_user_action', 'failed'].includes(String(state))) throw new Error('desktop_invalid_request')
      if (state === 'waiting_user_action') entry.window.show()
      await this.request(entry, state === 'failed' ? 'failed' : 'state', { state })
    })
  }

  async start() {
    if (this.stopped || this.ws || this.starting) return
    this.starting = true
    try {
      this.config = await this.options.config()
      if (this.stopped) return
      const ws = new WebSocket(this.socketURL('/api/v1/remote-desktop-automation/runtime'), { headers: { 'X-Termous-Token': this.config.apiToken }, maxPayload: 64 * 1024, handshakeTimeout: 10_000 })
      this.ws = ws
      ws.on('message', (raw, binary) => {
        if (this.stopped || binary || this.ws !== ws) { ws.close(); return }
        try {
          const message = JSON.parse(raw.toString()) as { hosts?: unknown; id?: string; value?: unknown; error?: string }
          if (message.hosts !== undefined) {
            if (!Array.isArray(message.hosts) || message.hosts.length > 4 || !message.hosts.every(isHost)) throw new Error('desktop_host_invalid')
            this.reconcile(message.hosts)
          } else if (message.id) {
            const pending = this.pending.get(message.id)
            if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); if (message.error) pending.reject(new Error('desktop_host_request_failed')); else pending.resolve(message.value) }
          }
        } catch { ws.close(); this.options.warn('desktop_automation_protocol_failed') }
      })
      ws.on('error', () => this.options.warn('desktop_automation_channel_failed'))
      ws.on('close', () => {
        if (this.ws !== ws) return
        this.ws = undefined
        this.disposeEntries()
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('desktop_executor_unavailable')) }
        this.pending.clear()
        if (!this.stopped) this.retry = setTimeout(() => { void this.start() }, 2000)
      })
    } catch {
      this.options.warn('desktop_automation_start_failed')
      if (!this.stopped) this.retry = setTimeout(() => { void this.start() }, 2000)
    } finally {
      this.starting = false
    }
  }

  private socketURL(path: string) {
    if (!this.config) throw new Error('desktop_executor_unavailable')
    const url = new URL(path, this.config.apiBaseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url
  }

  private request<T>(entry: Entry, action: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (this.stopped || this.entries.get(entry.host.id) !== entry || this.ws?.readyState !== WebSocket.OPEN || this.pending.size >= 16) return Promise.reject(new Error('desktop_executor_unavailable'))
    const id = String(++this.sequence)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('desktop_host_timeout')) }, 10_000)
      this.pending.set(id, { hostID: entry.host.id, resolve: value => resolve(value as T), reject, timer })
      this.ws!.send(JSON.stringify({ id, action, session_id: entry.host.session_id, host_id: entry.host.id, generation: entry.host.generation, ...fields }), err => {
        if (err) { clearTimeout(timer); this.pending.delete(id); reject(new Error('desktop_host_request_failed')) }
      })
    })
  }

  private async bootstrap(entry: Entry): Promise<DesktopAutomationBootstrap> {
    const info = await this.request<{ shared: boolean }>(entry, 'bootstrap')
    const ticket = await this.request<{ ticket: string; credential_ticket?: string }>(entry, 'attach')
    const url = this.socketURL('/api/v1/remote-desktop-stream')
    url.searchParams.set('ticket', ticket.ticket)
    entry.credential = ticket.credential_ticket ?? ''
    return { host: entry.host, ...this.options.appearance(), shared: info.shared, streamURL: url.toString(), credentialAvailable: !!entry.credential }
  }

  private own(event: IpcMainInvokeEvent): Entry {
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.webContents === event.sender && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === entry.url) return entry
    }
    throw new Error('desktop_sender_not_allowed')
  }

  private reconcile(hosts: DesktopAutomationHost[]) {
    if (this.stopped) return
    const ids = new Set(hosts.map(h => h.id))
    for (const [id, entry] of this.entries) if (!ids.has(id)) this.disposeEntry(entry)
    for (const host of hosts) {
      const previous = this.entries.get(host.id)
      if (previous) {
        if (host.show_sequence > previous.host.show_sequence) { previous.window.show(); previous.window.focus() }
        previous.host = host
      } else this.create(host)
    }
  }

  private create(host: DesktopAutomationHost) {
    const window = new BrowserWindow({ width: 1200, height: 800, show: false, paintWhenInitiallyHidden: true, autoHideMenuBar: true, title: `Termous · ${host.name}`,
      webPreferences: { preload: this.options.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
    })
    const url = this.options.devURL ? new URL(this.options.devURL) : pathToFileURL(this.options.renderer)
    url.searchParams.set('surface', 'desktop-automation')
    const entry: Entry = { window, host, url: url.toString(), credential: '' }
    this.entries.set(host.id, entry)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.on('close', event => { if (!this.stopped) { event.preventDefault(); window.hide() } })
    window.webContents.on('render-process-gone', () => this.fail(entry))
    void window.loadURL(entry.url).catch(() => this.fail(entry))
  }

  private fail(entry: Entry) {
    if (this.stopped || this.entries.get(entry.host.id) !== entry) return
    void this.request(entry, 'failed').catch(() => this.options.warn('desktop_automation_cleanup_failed'))
  }

  private disposeEntry(entry: Entry) {
    this.entries.delete(entry.host.id)
    entry.credential = ''
    // 宿主失效即结束它的在途票据请求，迟到响应不能进入其他执行入口。
    for (const [id, pending] of this.pending) {
      if (pending.hostID !== entry.host.id) continue
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new Error('desktop_executor_unavailable'))
    }
    entry.window.destroy()
  }

  private disposeEntries() { for (const entry of this.entries.values()) this.disposeEntry(entry) }
  close() {
    this.stopped = true
    clearTimeout(this.retry)
    this.ws?.close()
    this.disposeEntries()
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('desktop_executor_unavailable')) }
    this.pending.clear()
  }
}

function isHost(value: unknown): value is DesktopAutomationHost {
  if (!value || typeof value !== 'object') return false
  const h = value as DesktopAutomationHost
  return typeof h.id === 'string' && /^[\w-]{1,128}$/.test(h.id) && typeof h.session_id === 'string' && /^[\w-]{1,128}$/.test(h.session_id) && Number.isSafeInteger(h.generation) && h.generation > 0 && typeof h.name === 'string' && h.name.length <= 512 && typeof h.state === 'string' && Number.isSafeInteger(h.show_sequence)
}
