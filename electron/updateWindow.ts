import { pathToFileURL } from 'node:url'
import type { BrowserWindowConstructorOptions } from 'electron'
import type {
  UpdateWindowBootstrap,
  UpdateWindowLanguage,
  UpdateWindowTheme,
} from '#common/contracts'

export type {
  UpdateWindowBootstrap,
  UpdateWindowLanguage,
  UpdateWindowTheme,
} from '#common/contracts'

interface NavigationEventLike {
  preventDefault(): void
}

interface UpdateWindowWebContentsLike {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(
    event: 'did-finish-load',
    listener: () => void,
  ): void
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: NavigationEventLike, url: string) => void,
  ): void
}

export interface UpdateBrowserWindowLike {
  webContents: UpdateWindowWebContentsLike
  close(): void
  focus(): void
  isDestroyed(): boolean
  isMinimized(): boolean
  loadFile(filePath: string, options?: { query?: Record<string, string> }): Promise<void>
  loadURL(url: string): Promise<void>
  minimize(): void
  on(
    event: 'close',
    listener: (event: NavigationEventLike) => void,
  ): void
  on(event: 'closed', listener: () => void): void
  once(event: 'ready-to-show', listener: () => void): void
  restore(): void
  setBackgroundColor?(color: string): void
  show(): void
}

export interface UpdateWindowControllerOptions<TSnapshot> {
  createWindow(options: BrowserWindowConstructorOptions): UpdateBrowserWindowLike
  canClose?(): boolean
  devServerURL?: string
  getSnapshot(): TSnapshot
  iconPath?: string
  initialLanguage: UpdateWindowLanguage
  initialTheme: UpdateWindowTheme
  isQuitting?(): boolean
  onError?(error: unknown): void
  openReleasePage?(url: string): Promise<void> | void
  platform: NodeJS.Platform
  preloadPath: string
  releasePageUrl?: string
  rendererFilePath: string
  title?: string
}

const bootstrapChangedChannel = 'app-update:window-bootstrap-changed'

export class UpdateWindowController<TSnapshot = unknown> {
  private bootstrapSequence = 0
  private currentWindow: UpdateBrowserWindowLike | null = null
  private language: UpdateWindowLanguage
  private loaded = false
  private theme: UpdateWindowTheme
  private readonly options: UpdateWindowControllerOptions<TSnapshot>

  constructor(options: UpdateWindowControllerOptions<TSnapshot>) {
    this.options = options
    this.language = options.initialLanguage
    this.theme = options.initialTheme
  }

  open() {
    if (this.options.isQuitting?.()) {
      return null
    }
    this.bootstrapSequence += 1

    const existing = this.getWindow()
    if (existing) {
      this.reveal(existing)
      this.publishBootstrap(existing)
      return existing
    }

    const target = this.createWindow()
    this.currentWindow = target
    this.loaded = false
    this.bindWindow(target)
    this.loadRenderer(target)
    return target
  }

  close() {
    const target = this.getWindow()
    if (!target || !this.canClose()) {
      return false
    }
    target.close()
    return true
  }

  minimize() {
    const target = this.getWindow()
    if (!target) {
      return false
    }
    target.minimize()
    return true
  }

  getBootstrap(): UpdateWindowBootstrap<TSnapshot> {
    return {
      bootstrap_seq: this.bootstrapSequence,
      language: this.language,
      snapshot: this.options.getSnapshot(),
      theme: this.theme,
    }
  }

  getWindow() {
    const target = this.currentWindow
    if (!target || target.isDestroyed()) {
      this.currentWindow = null
      this.loaded = false
      return null
    }
    return target
  }

  ownsWebContents(webContentsId: number) {
    return this.getWindow()?.webContents.id === webContentsId
  }

  updateAppearance(theme: UpdateWindowTheme, language: UpdateWindowLanguage) {
    if (this.theme === theme && this.language === language) {
      return
    }
    this.theme = theme
    this.language = language
    this.bootstrapSequence += 1
    const target = this.getWindow()
    target?.setBackgroundColor?.(windowBackground(theme))
    this.publishBootstrap(target)
  }

  private createWindow() {
    const isMac = this.options.platform === 'darwin'
    return this.options.createWindow({
      width: 720,
      height: 700,
      minWidth: 640,
      minHeight: 600,
      useContentSize: true,
      frame: isMac,
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      backgroundColor: windowBackground(this.theme),
      title: this.options.title ?? 'About Termous',
      icon: this.options.iconPath,
      show: false,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
  }

  private bindWindow(target: UpdateBrowserWindowLike) {
    target.webContents.setWindowOpenHandler(({ url }) => {
      const openReleasePage = this.options.openReleasePage
      if (openReleasePage && url === this.options.releasePageUrl) {
        try {
          void Promise.resolve(openReleasePage(url)).catch((error) => {
            this.options.onError?.(error)
          })
        } catch (error) {
          this.options.onError?.(error)
        }
      }
      return { action: 'deny' }
    })
    const guardNavigation = (event: NavigationEventLike, url: string) => {
      if (!this.isTrustedRendererURL(url)) {
        event.preventDefault()
      }
    }
    target.webContents.on('will-navigate', guardNavigation)
    target.webContents.on('will-redirect', guardNavigation)
    target.webContents.on('did-finish-load', () => {
      if (this.currentWindow !== target) {
        return
      }
      this.loaded = true
      this.publishBootstrap(target)
    })
    target.once('ready-to-show', () => {
      if (this.currentWindow === target) {
        this.reveal(target)
      }
    })
    target.on('close', (event) => {
      if (!this.canClose()) {
        event.preventDefault()
      }
    })
    target.on('closed', () => {
      if (this.currentWindow === target) {
        this.currentWindow = null
        this.loaded = false
      }
    })
  }

  private loadRenderer(target: UpdateBrowserWindowLike) {
    const load = this.options.devServerURL
      ? target.loadURL(updateSurfaceURL(this.options.devServerURL))
      : target.loadFile(this.options.rendererFilePath, { query: { surface: 'update' } })
    void load.catch((error) => {
      if (this.currentWindow !== target || target.isDestroyed()) {
        return
      }
      target.close()
      this.options.onError?.(error)
    })
  }

  private isTrustedRendererURL(url: string) {
    try {
      const actual = new URL(url)
      if (actual.searchParams.get('surface') !== 'update') {
        return false
      }
      if (this.options.devServerURL) {
        const expected = new URL(this.options.devServerURL)
        return actual.origin === expected.origin && normalizedPath(actual.pathname) === normalizedPath(expected.pathname)
      }
      const expected = new URL(pathToFileURL(this.options.rendererFilePath).href)
      return actual.protocol === 'file:' && actual.href.split('?')[0] === expected.href
    } catch {
      return false
    }
  }

  private publishBootstrap(target: UpdateBrowserWindowLike | null) {
    if (!target || !this.loaded || target.webContents.isDestroyed()) {
      return
    }
    target.webContents.send(bootstrapChangedChannel, this.getBootstrap())
  }

  private reveal(target: UpdateBrowserWindowLike) {
    if (target.isMinimized()) {
      target.restore()
    }
    target.show()
    target.focus()
  }

  private canClose() {
    return this.options.isQuitting?.() || this.options.canClose?.() !== false
  }
}

export function updateSurfaceURL(baseURL: string) {
  const url = new URL(baseURL)
  url.searchParams.set('surface', 'update')
  return url.href
}

function normalizedPath(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function windowBackground(theme: UpdateWindowTheme) {
  return theme === 'dark' ? '#0f1116' : '#f4f5f7'
}
