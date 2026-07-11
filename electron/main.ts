import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { CoreProcessManager } from './coreProcess'
import { TermousTrayController } from './tray'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const APP_NAME = 'Termous'
const APP_ID = 'dev.termous.app'
const APP_ICON = path.join(process.env.VITE_PUBLIC, 'termous-icon.png')
const TRAY_ICON = path.join(process.env.VITE_PUBLIC, process.platform === 'win32' ? 'favicon.ico' : 'termous-icon.png')
const WEB_DEBUG_FILE = 'webDebug'
const DEVTOOLS_CHORD_WINDOW_MS = 900
const STARTUP_MIN_VISIBLE_MS = 650
const APPEARANCE_CACHE_FILE = 'appearance.json'
const coreProcess = new CoreProcessManager()
const trayController = new TermousTrayController({
  appName: APP_NAME,
  iconCandidates: [TRAY_ICON, APP_ICON],
  getWindow: () => win,
  showMainWindow,
  quitApp: quitFromTray,
})

type StartupPhase = 'core' | 'workspace' | 'error'
type AppTheme = 'dark' | 'light'

let win: BrowserWindow | null
let splashWin: BrowserWindow | null = null
let appTheme: AppTheme = 'dark'
let closeConfirmed = false
let mainWindowReady = false
let startupReadyRequested = false
let startupCompleted = false
let splashPhase: StartupPhase = 'core'
let splashStartedAt = 0
let startupCompletionTimer: NodeJS.Timeout | null = null

function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light'
}

function appearanceCachePath() {
  return path.join(app.getPath('userData'), APPEARANCE_CACHE_FILE)
}

function readCachedAppTheme(): AppTheme {
  try {
    const cached = JSON.parse(readFileSync(appearanceCachePath(), 'utf8')) as { theme?: unknown }
    if (isAppTheme(cached.theme)) {
      return cached.theme
    }
  } catch {
    // 缓存缺失或损坏时使用系统主题，后端设置加载后会重新同步。
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function writeCachedAppTheme(theme: AppTheme) {
  try {
    mkdirSync(path.dirname(appearanceCachePath()), { recursive: true })
    writeFileSync(appearanceCachePath(), JSON.stringify({ theme }), 'utf8')
    return true
  } catch {
    return false
  }
}

function createSplashWindow() {
  if (splashWin && !splashWin.isDestroyed()) {
    return
  }
  splashStartedAt = Date.now()
  splashWin = new BrowserWindow({
    width: 400,
    height: 236,
    useContentSize: true,
    frame: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    hasShadow: true,
    title: `${APP_NAME} Startup`,
    backgroundColor: appTheme === 'dark' ? '#181c24' : '#f7f8fa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  splashWin.center()
  splashWin.once('ready-to-show', () => {
    if (!startupCompleted) {
      splashWin?.show()
    }
  })
  splashWin.webContents.once('did-finish-load', applySplashPhase)
  splashWin.on('closed', () => {
    splashWin = null
  })
  void splashWin
    .loadFile(path.join(process.env.VITE_PUBLIC, 'startup.html'), { query: { theme: appTheme } })
    .catch(() => {
      closeSplashWindow()
    })
}

function applySplashPhase() {
  const target = splashWin
  if (!target || target.isDestroyed() || target.webContents.isLoading()) {
    return
  }
  const script = `window.termousStartup?.setTheme(${JSON.stringify(appTheme)}); window.termousStartup?.setPhase(${JSON.stringify(splashPhase)})`
  void target.webContents.executeJavaScript(script).catch(() => undefined)
}

function updateSplashPhase(phase: StartupPhase) {
  splashPhase = phase
  applySplashPhase()
}

function closeSplashWindow() {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.destroy()
  }
  splashWin = null
}

function revealMainWindow() {
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

function tryCompleteStartup() {
  if (startupCompleted || startupCompletionTimer || !startupReadyRequested || !mainWindowReady) {
    return
  }
  const remaining = splashWin
    ? Math.max(0, STARTUP_MIN_VISIBLE_MS - (Date.now() - splashStartedAt))
    : 0
  startupCompletionTimer = setTimeout(() => {
    startupCompletionTimer = null
    if (!startupReadyRequested || !mainWindowReady) {
      return
    }
    startupCompleted = true
    revealMainWindow()
    closeSplashWindow()
  }, remaining)
}

function shouldAutoOpenDevTools() {
  const candidates = [
    path.join(process.cwd(), WEB_DEBUG_FILE),
    path.join(path.dirname(process.execPath), WEB_DEBUG_FILE),
    path.join(process.env.APP_ROOT, WEB_DEBUG_FILE),
  ]
  return Array.from(new Set(candidates)).some((candidate) => existsSync(candidate))
}

function openDevTools(target: BrowserWindow) {
  if (!target.webContents.isDevToolsOpened()) {
    target.webContents.openDevTools({ mode: 'detach' })
  }
}

function registerDevToolsShortcut(target: BrowserWindow) {
  let firstFAt = 0
  target.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) {
      return
    }
    const isDevToolsChord = input.control && input.shift && input.alt && input.key.toLowerCase() === 'f'
    if (!isDevToolsChord) {
      firstFAt = 0
      return
    }
    event.preventDefault()
    const now = Date.now()
    if (now - firstFAt <= DEVTOOLS_CHORD_WINDOW_MS) {
      firstFAt = 0
      openDevTools(target)
      return
    }
    firstFAt = now
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindowReady = false
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    useContentSize: true,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    backgroundColor: appTheme === 'dark' ? '#0f1116' : '#f4f5f7',
    title: APP_NAME,
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  registerDevToolsShortcut(win)

  win.once('ready-to-show', () => {
    mainWindowReady = true
    if (startupCompleted) {
      revealMainWindow()
    } else {
      tryCompleteStartup()
    }
    if (win && shouldAutoOpenDevTools()) {
      openDevTools(win)
    }
    const fatal = coreProcess.getFatal()
    if (fatal) {
      win?.webContents.send('core:fatal', fatal)
    }
  })
  win.on('close', (event) => {
    if (closeConfirmed) {
      closeConfirmed = false
      return
    }
    event.preventDefault()
    win?.webContents.send('window:close-requested')
  })
  win.on('closed', () => {
    win = null
    mainWindowReady = false
  })
  win.on('maximize', () => {
    win?.webContents.send('window:maximize-state', true)
  })
  win.on('unmaximize', () => {
    win?.webContents.send('window:maximize-state', false)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const allowed = VITE_DEV_SERVER_URL
      ? target.origin === new URL(VITE_DEV_SERVER_URL).origin
      : target.href === pathToFileURL(path.join(RENDERER_DIST, 'index.html')).href
    if (!allowed) {
      event.preventDefault()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function showMainWindow() {
  if (!startupCompleted) {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.show()
      splashWin.focus()
    }
    return
  }
  if (!win || win.isDestroyed()) {
    createWindow()
  }
  revealMainWindow()
}

async function quitFromTray() {
  const target = win
  await coreProcess.shutdownGracefully()
  closeConfirmed = true
  closeSplashWindow()
  if (target && !target.isDestroyed()) {
    target.close()
    return
  }
  app.quit()
}

function registerWindowControls() {
  const currentWindow = () => BrowserWindow.getFocusedWindow() ?? win
  ipcMain.handle('window:minimize', () => {
    const focused = currentWindow()
    if (!focused) return false
    focused.minimize()
    return true
  })
  ipcMain.handle('window:toggle-maximize', () => {
    const focused = currentWindow()
    if (!focused) return false
    if (focused.isMaximized()) {
      focused.unmaximize()
      return false
    }
    focused.maximize()
    return true
  })
  ipcMain.handle('window:request-close', () => {
    const focused = currentWindow()
    if (!focused) return false
    focused.webContents.send('window:close-requested')
    return true
  })
  ipcMain.handle('window:minimize-to-tray', () => {
    const focused = currentWindow()
    if (!focused) return false
    focused.hide()
    return true
  })
  ipcMain.handle('window:confirm-close', async () => {
    const focused = currentWindow()
    if (!focused) return false
    await coreProcess.shutdownGracefully()
    closeConfirmed = true
    closeSplashWindow()
    focused.close()
    return true
  })
  ipcMain.handle('window:is-maximized', () => currentWindow()?.isMaximized() ?? false)
}

function registerCoreProcessControls() {
  ipcMain.handle('core:get-config', () => coreProcess.initialize())
  ipcMain.handle('core:status', () => coreProcess.status())
  ipcMain.handle('core:shutdown', () => coreProcess.shutdownGracefully())
  ipcMain.handle('core:get-fatal', () => coreProcess.getFatal())
}

function registerStartupControls() {
  ipcMain.handle('startup:ready', () => {
    startupReadyRequested = true
    tryCompleteStartup()
    return true
  })
}

function registerAppearanceControls() {
  ipcMain.handle('appearance:set-theme', (_event, theme: unknown) => {
    if (!isAppTheme(theme)) {
      return false
    }
    appTheme = theme
    nativeTheme.themeSource = theme
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.setBackgroundColor(theme === 'dark' ? '#181c24' : '#f7f8fa')
    }
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(theme === 'dark' ? '#0f1116' : '#f4f5f7')
    }
    applySplashPhase()
    return writeCachedAppTheme(theme)
  })
}

function registerTrayControls() {
  ipcMain.handle('tray:update-state', (_event, state: unknown) => {
    trayController.updateState(state ?? {})
    return true
  })
}

function registerFilePickers() {
  const currentWindow = () => BrowserWindow.getFocusedWindow() ?? win
  ipcMain.handle('files:pick-paths', async (_event, options?: { mode?: string; multiple?: boolean }) => {
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
    const mode = options?.mode ?? 'files'
    if (mode === 'directories') {
      properties.push('openDirectory')
    } else if (mode === 'files-and-directories') {
      properties.push('openFile', 'openDirectory')
    } else {
      properties.push('openFile')
    }
    if (options?.multiple !== false) {
      properties.push('multiSelections')
    }
    const focused = currentWindow()
    const result = focused
      ? await dialog.showOpenDialog(focused, { properties })
      : await dialog.showOpenDialog({ properties })
    if (result.canceled) {
      return []
    }
    return result.filePaths
  })
  ipcMain.handle('files:open-directory', async (_event, localPath?: string) => {
    if (typeof localPath !== 'string' || localPath.trim() === '') {
      return { ok: false, error: 'invalid_directory' }
    }
    const targetPath = localPath.trim()
    if (!existsSync(targetPath)) {
      return { ok: false, error: 'directory_not_found' }
    }
    try {
      const targetStat = statSync(targetPath)
      const directoryPath = targetStat.isDirectory() ? targetPath : path.dirname(targetPath)
      if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
        return { ok: false, error: 'directory_not_found' }
      }
      const error = await shell.openPath(directoryPath)
      return { ok: !error, error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'open_directory_failed' }
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  if (startupCompletionTimer) {
    clearTimeout(startupCompletionTimer)
    startupCompletionTimer = null
  }
  closeSplashWindow()
  trayController.destroy()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!startupCompleted) {
      createSplashWindow()
    }
    createWindow()
  }
})

app.whenReady().then(() => {
  app.setName(APP_NAME)
  appTheme = readCachedAppTheme()
  nativeTheme.themeSource = appTheme
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID)
  }
  Menu.setApplicationMenu(null)
  registerCoreProcessControls()
  registerStartupControls()
  registerAppearanceControls()
  registerWindowControls()
  registerTrayControls()
  registerFilePickers()
  createSplashWindow()
  createWindow()
  trayController.initialize()
  void coreProcess.initialize().then(() => {
    updateSplashPhase(coreProcess.getFatal() ? 'error' : 'workspace')
  })
})
