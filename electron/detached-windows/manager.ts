import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { appDebugModeArgument, detachedChannels as channels, isDetachedIdentity, isDetachedPacket, sameDetachedConnection,
  type DetachedAppearance, type DetachedConnection, type DetachedIdentity, type DetachedRect } from '#common/contracts'
import { detachedModules, type DetachedModuleRegistration } from './registry.ts'
import { clampDetachedBounds } from './geometry.ts'
import { captureDetachedWorkspace } from './capture.ts'
import { sendDetachedPacket, trustedDetachedEntry, validateDetachedRequest, type DetachedEntry } from './broker.ts'

interface Options {
  trusted: (event: IpcMainInvokeEvent) => boolean
  host: () => BrowserWindow | null
  reveal: () => void
  appearance: () => DetachedAppearance
  renderer: string
  preload: string
  devURL?: string
  debugMode?: boolean
  modules?: readonly DetachedModuleRegistration[]
}

export class DetachedWindows {
  private readonly entries = new Map<string, DetachedEntry>()
  private readonly bounds = new Map<string, DetachedRect>()
  private hostWindow?: BrowserWindow
  private originalThrottling?: boolean
  private stopping = false

  constructor(private readonly options: Options) {
    ipcMain.handle(channels.open, (event, identity: unknown, rect?: DetachedRect) => {
      if (!options.trusted(event) || !isDetachedIdentity(identity)) throw new Error('detached_sender_not_allowed')
      return this.open(identity, rect)
    })
    ipcMain.handle(channels.focus, (event, identity: unknown) => {
      if (!options.trusted(event) || !isDetachedIdentity(identity)) throw new Error('detached_sender_not_allowed')
      const entry = this.entries.get(this.key(identity))
      if (!entry) return false
      if (entry.ready) this.focus(entry.window)
      return true
    })
    ipcMain.handle(channels.close, (event, connection: DetachedConnection) => {
      if (!options.trusted(event) || !isDetachedIdentity(connection)) throw new Error('detached_sender_not_allowed')
      const entry = this.entries.get(this.key(connection))
      if (entry && sameDetachedConnection(connection, entry.connection)) entry.window.destroy()
    })
    ipcMain.handle(channels.reveal, event => {
      if (!options.trusted(event)) throw new Error('detached_sender_not_allowed')
      options.reveal()
    })
    ipcMain.handle(channels.bootstrap, event => {
      const entry = trustedDetachedEntry(this.entries.values(), event)
      if (!entry) throw new Error('detached_sender_not_allowed')
      return { ...entry.connection, appearance: options.appearance() }
    })
    ipcMain.on(channels.packet, (event, packet: unknown) => {
      if (!isDetachedPacket(packet)) return
      if (options.trusted(event as unknown as IpcMainInvokeEvent)) {
        const entry = this.entries.get(this.key(packet.connection))
        if (!entry || !sameDetachedConnection(entry.connection, packet.connection)) return
        if (packet.kind === 'initialize' && !entry.started) {
          entry.started = true
          void entry.window.loadURL(entry.url).catch(() => { if (!entry.window.isDestroyed()) entry.window.destroy() })
        } else if (packet.kind === 'ready' && entry.started) {
          entry.ready = true
          clearTimeout(entry.timer)
          sendDetachedPacket(entry.window, packet)
          this.focus(entry.window)
        } else if (['state', 'response', 'request', 'appearance'].includes(packet.kind)) sendDetachedPacket(entry.window, packet)
        return
      }
      const entry = trustedDetachedEntry(this.entries.values(), event)
      if (!entry || !validateDetachedRequest(entry, packet)) return
      sendDetachedPacket(options.host(), packet)
    })
  }

  private key(identity: DetachedIdentity) { return `${identity.module}:${identity.instance}` }

  private async open(identity: DetachedIdentity, rect?: DetachedRect) {
    const registration = (this.options.modules ?? detachedModules).find(item => item.type === identity.module && item.instance === identity.instance)
    const host = this.options.host()
    if (!registration || this.stopping || !host || host.isDestroyed()) throw new Error('detached_unavailable')
    const key = this.key(identity)
    const existing = this.entries.get(key)
    if (existing) { if (existing.ready) this.focus(existing.window); return existing.connection }
    this.bindHost(host)
    const saved = this.bounds.get(key)
    const work = screen.getDisplayMatching(saved ?? host.getBounds()).workArea
    const size = registration.size ?? { width: 1100, height: 800, minWidth: 480, minHeight: 520 }
    const window = new BrowserWindow({ ...clampDetachedBounds(saved, work, size), minWidth: Math.min(size.minWidth, work.width), minHeight: Math.min(size.minHeight, work.height),
      title: registration.title, show: false, autoHideMenuBar: true,
      backgroundColor: this.options.appearance().theme === 'dark' ? '#0f1116' : '#f4f5f7',
      webPreferences: { preload: this.options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        additionalArguments: this.options.debugMode ? [appDebugModeArgument] : [] },
    })
    const connection = { ...identity, generation: randomUUID() }
    const url = this.options.devURL ? new URL(this.options.devURL) : pathToFileURL(this.options.renderer)
    url.searchParams.set('surface', 'detached')
    const entry: DetachedEntry = { window, connection, registration, url: url.href, ready: false }
    // 先占位，再异步截图和加载，重复点击只能获得同一代窗口。
    this.entries.set(key, entry)
    entry.timer = setTimeout(() => { if (!entry.ready && !window.isDestroyed()) window.destroy() }, 20000)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy() })
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame && entry.ready && !window.isDestroyed()) window.destroy()
    })
    window.on('close', event => {
      if (this.stopping || !entry.ready) return
      event.preventDefault()
      sendDetachedPacket(host, { connection, kind: 'return', payload: false })
    })
    window.on('resize', () => this.bounds.set(key, window.getNormalBounds()))
    window.on('move', () => this.bounds.set(key, window.getNormalBounds()))
    window.once('closed', () => {
      clearTimeout(entry.timer)
      this.entries.delete(key)
      this.updateThrottling()
      sendDetachedPacket(host, { connection, kind: 'closed' })
    })
    try {
      const capture = await captureDetachedWorkspace(host.webContents, rect)
      if (window.isDestroyed() || host.isDestroyed()) throw new Error('detached_host_unavailable')
      this.updateThrottling()
      // 宿主安装接收器后显式 initialize，避免子窗口初始化请求早于 open 的响应。
      return { ...connection, capture }
    } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error }
  }

  private bindHost(host: BrowserWindow) {
    if (this.hostWindow === host) return
    this.hostWindow = host
    this.originalThrottling = undefined
    host.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) this.closeAll() })
    host.webContents.on('render-process-gone', () => this.closeAll())
    host.once('closed', () => this.closeAll())
  }

  private updateThrottling() {
    const host = this.hostWindow
    if (!host || host.isDestroyed() || host.webContents.isDestroyed()) return
    const needed = [...this.entries.values()].some(entry => entry.registration.requiresHost)
    if (needed && this.originalThrottling === undefined) {
      this.originalThrottling = host.webContents.getBackgroundThrottling()
      host.webContents.setBackgroundThrottling(false)
    } else if (!needed && this.originalThrottling !== undefined) {
      host.webContents.setBackgroundThrottling(this.originalThrottling)
      this.originalThrottling = undefined
    }
  }

  private focus(window: BrowserWindow) { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
  private closeAll() { for (const entry of [...this.entries.values()]) if (!entry.window.isDestroyed()) entry.window.destroy() }
  close() { this.stopping = true; this.closeAll() }
}
