import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => {
    win?.show()
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
    const allowed = VITE_DEV_SERVER_URL ? target.origin === new URL(VITE_DEV_SERVER_URL).origin : target.protocol === 'file:'
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
  ipcMain.handle('window:minimize', () => currentWindow()?.minimize())
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
  ipcMain.handle('window:request-close', () => currentWindow()?.webContents.send('window:close-requested'))
  ipcMain.handle('window:confirm-close', () => {
    const focused = currentWindow()
    if (!focused) return
    closeConfirmed = true
    focused.close()
  })
  ipcMain.handle('window:is-maximized', () => currentWindow()?.isMaximized() ?? false)
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerWindowControls()
  createWindow()
})
