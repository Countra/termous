import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import type { AppConfig, AppLanguage, AppTheme } from '#common/contracts'

interface Options {
  trusted: (event: IpcMainInvokeEvent) => boolean
  config: () => Promise<AppConfig>
  appearance: () => { language: AppLanguage; theme: AppTheme }
  renderer: string
  preload: string
  devURL?: string
}

export class DesktopWindows {
  private readonly entries = new Map<BrowserWindow, { sessionId: string; url: string }>()
  private pending = 0
  private stopping = false

  constructor(options: Options) {
    ipcMain.handle('desktop:open', async (event, id: unknown) => {
      if (!options.trusted(event) || typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error('desktop_sender_not_allowed')
      if (this.stopping || this.entries.size + this.pending >= 16) throw new Error('desktop_window_limit')
      this.pending++
      try {
        const config = await options.config()
        const response = await fetch(new URL(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}`, config.apiBaseUrl), {
          headers: { 'X-Termous-Token': config.apiToken }, signal: AbortSignal.timeout(10000), redirect: 'error',
        })
        if (!response.ok || (await response.json() as { protocol?: string }).protocol !== 'rdp') throw new Error('desktop_session_unavailable')
        if (this.stopping || !options.trusted(event)) throw new Error('desktop_sender_not_allowed')
        const window = new BrowserWindow({ width: 1200, height: 800, minWidth: 600, minHeight: 400, show: false, autoHideMenuBar: true, title: 'Termous · RDP',
          webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
        })
        const entry = { sessionId: id, url: '' }
        this.entries.set(window, entry)
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', event => event.preventDefault())
        window.webContents.on('will-redirect', event => event.preventDefault())
        window.webContents.on('will-attach-webview', event => event.preventDefault())
        window.once('ready-to-show', () => window.show())
        // 关闭窗口仅销毁订阅；连接在保留期届满、显式断开或应用退出时释放。
        window.once('closed', () => this.entries.delete(window))
        try {
          if (options.devURL) {
            const url = new URL(options.devURL)
            url.searchParams.set('surface', 'desktop')
            entry.url = url.toString()
            await window.loadURL(entry.url)
          } else {
            const { pathToFileURL } = await import('node:url')
            const url = pathToFileURL(options.renderer)
            url.searchParams.set('surface', 'desktop')
            entry.url = url.toString()
            await window.loadURL(entry.url)
          }
        } catch { window.destroy(); throw new Error('desktop_window_unavailable') }
      } finally { this.pending-- }
    })
    ipcMain.handle('desktop:bootstrap', async event => {
      const entry = this.own(event)
      return { config: await options.config(), sessionId: entry.sessionId, ...options.appearance() }
    })
    ipcMain.handle('desktop:close', event => {
      this.own(event)
      BrowserWindow.fromWebContents(event.sender)?.close()
    })
    ipcMain.handle('desktop:pick-paths', async (event, input: unknown) => {
      this.own(event)
      if (!input || typeof input !== 'object') throw new Error('desktop_picker_invalid')
      const { mode, multiple } = input as { mode?: unknown; multiple?: unknown }
      if (!['files', 'directories', 'files-and-directories'].includes(String(mode)) || typeof multiple !== 'boolean') throw new Error('desktop_picker_invalid')
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('desktop_sender_not_allowed')
      const properties: NonNullable<OpenDialogOptions['properties']> = []
      if (mode !== 'directories') properties.push('openFile')
      if (mode !== 'files') properties.push('openDirectory')
      if (multiple) properties.push('multiSelections')
      const result = await dialog.showOpenDialog(window, { properties })
      this.own(event)
      return result.canceled ? [] : result.filePaths
    })
  }

  private own(event: IpcMainInvokeEvent) {
    const window = BrowserWindow.fromWebContents(event.sender)
    const entry = window ? this.entries.get(window) : undefined
    if (!entry || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== entry.url) throw new Error('desktop_sender_not_allowed')
    return entry
  }

  close() {
    this.stopping = true
    for (const window of this.entries.keys()) window.destroy()
    this.entries.clear()
  }

  accepts(event: IpcMainInvokeEvent, sessionId: string): boolean {
    const window = BrowserWindow.fromWebContents(event.sender)
    const entry = window ? this.entries.get(window) : undefined
    return !!entry && entry.sessionId === sessionId && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === entry.url
  }
}
