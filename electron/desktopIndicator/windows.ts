import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import type { DesktopIndicatorState } from '#common/contracts'
import { badgeSize, barSize, indicatorBounds, sameBounds } from './geometry.ts'
import { configureIndicatorWindow } from './platform.ts'

type Role = DesktopIndicatorState['role']
interface Entry { window: BrowserWindow; url: string; role: Role; ready: boolean }
interface Options {
  preload: string; renderer: string; devURL?: string
  state(role: Role): DesktopIndicatorState
  exitCommitted(): boolean
  warn(code: string): void
}
export class DesktopIndicatorWindows {
  private entries: Entry[] = []
  private timer?: ReturnType<typeof setInterval>
  private retry?: ReturnType<typeof setTimeout>
  private active = false
  private closed = false
  private appearance = ''
  constructor(private readonly options: Options) {
    screen.on('display-added', this.position)
    screen.on('display-removed', this.position)
    screen.on('display-metrics-changed', this.position)
  }
  update(active: boolean) {
    if (this.closed) return
    if (this.options.exitCommitted()) { this.close(); return }
    this.active = active
    if (!active) {
      clearInterval(this.timer)
      this.timer = undefined
      for (const e of this.entries) if (!e.window.isDestroyed()) e.window.hide()
      return
    }
    try {
      if (!this.entries.length && !this.retry) this.create()
      this.publish()
      this.position()
      // 仅托管期间读取系统鼠标，位置不变时不操作窗口。
      this.timer ??= setInterval(this.position, 34)
    } catch { this.failed() }
  }
  private create() {
    for (const role of ['badge', 'bar'] as const) {
      const window = new BrowserWindow({ ...(role === 'badge' ? badgeSize : barSize), show: false, frame: false, transparent: true,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
        focusable: role === 'bar', hasShadow: false, backgroundColor: '#00000000', title: 'Termous',
        ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
      })
      const url = this.options.devURL ? new URL(this.options.devURL) : pathToFileURL(this.options.renderer)
      url.searchParams.set('surface', 'desktop-indicator')
      const entry: Entry = { window, url: url.toString(), role, ready: false }
      this.entries.push(entry)
      configureIndicatorWindow(window, role === 'badge', this.options.warn)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('will-redirect', event => event.preventDefault())
      window.webContents.on('will-attach-webview', event => event.preventDefault())
      window.on('close', event => {
        // 退出已获协调器确认时不阻止关窗，也不把正常退出当成崩溃重建。
        if (this.options.exitCommitted()) { this.close(); return }
        event.preventDefault()
        this.failed()
      })
      // destroy() 不触发 close；强制销毁也必须清除窗口引用，退出时不得重建。
      window.once('closed', () => { if (this.entries.includes(entry)) this.failed() })
      window.webContents.on('render-process-gone', () => { if (this.entries.includes(entry)) this.failed() })
      window.once('ready-to-show', () => { if (this.entries.includes(entry)) { entry.ready = true; this.update(this.active) } })
      void window.loadURL(entry.url).catch(() => { if (this.entries.includes(entry)) this.failed() })
    }
  }
  own(event: IpcMainInvokeEvent): Role {
    const entry = this.entries.find(e => !e.window.isDestroyed() && e.window.webContents === event.sender
      && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === e.url)
    if (!entry) throw new Error('desktop_indicator_sender_denied')
    return entry.role
  }
  private publish() {
    for (const e of this.entries) if (e.ready && !e.window.isDestroyed() && !e.window.webContents.isDestroyed()) {
      e.window.webContents.send('desktop-indicator:state', this.options.state(e.role))
    }
  }
  private position = () => {
    if (!this.active || this.closed || !this.entries.length) return
    if (this.options.exitCommitted()) { this.close(); return }
    try {
      const point = screen.getCursorScreenPoint()
      const bounds = indicatorBounds(point, screen.getDisplayNearestPoint(point).workArea)
      const state = this.options.state('bar')
      const appearance = `${state.theme}:${state.language}`
      if (appearance !== this.appearance) { this.appearance = appearance; this.publish() }
      for (const e of this.entries) {
        if (e.window.isDestroyed()) continue
        if (!sameBounds(e.window.getBounds(), bounds[e.role])) e.window.setBounds(bounds[e.role], false)
        if (e.ready && !e.window.isVisible()) e.window.showInactive()
      }
    } catch { this.failed() }
  }
  private failed() {
    if (this.closed) return
    if (this.options.exitCommitted()) { this.close(); return }
    this.options.warn('desktop_indicator_window_failed')
    this.dispose()
    if (!this.retry) this.retry = setTimeout(() => { this.retry = undefined; this.update(this.active) }, 2000)
  }
  private dispose() {
    clearInterval(this.timer)
    this.timer = undefined
    const entries = this.entries
    this.entries = []
    for (const e of entries) if (!e.window.isDestroyed()) e.window.destroy()
  }
  close() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.retry)
    screen.removeListener('display-added', this.position)
    screen.removeListener('display-removed', this.position)
    screen.removeListener('display-metrics-changed', this.position)
    this.dispose()
  }
}
