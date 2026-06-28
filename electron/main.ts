import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { CoreProcessManager } from './coreProcess'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const APP_NAME = 'Termous'
const APP_ID = 'dev.termous.app'
const APP_ICON = path.join(process.env.VITE_PUBLIC, 'termous-icon.png')
const coreProcess = new CoreProcessManager()

let win: BrowserWindow | null
let closeConfirmed = false

function createWindow() {
  const isMac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    useContentSize: true,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    backgroundColor: '#0d1118',
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

  win.once('ready-to-show', () => {
    win?.show()
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
  ipcMain.handle('window:confirm-close', async () => {
    const focused = currentWindow()
    if (!focused) return false
    await coreProcess.shutdownGracefully()
    closeConfirmed = true
    focused.close()
    return true
  })
  ipcMain.handle('window:is-maximized', () => currentWindow()?.isMaximized() ?? false)
}

function registerCoreProcessControls() {
  ipcMain.handle('core:get-config', () => coreProcess.getConfig())
  ipcMain.handle('core:status', () => coreProcess.status())
  ipcMain.handle('core:shutdown', () => coreProcess.shutdownGracefully())
  ipcMain.handle('core:get-fatal', () => coreProcess.getFatal())
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  app.setName(APP_NAME)
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID)
  }
  Menu.setApplicationMenu(null)
  await coreProcess.initialize()
  registerCoreProcessControls()
  registerWindowControls()
  registerFilePickers()
  createWindow()
})
