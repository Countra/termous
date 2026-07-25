import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { chmod, lstat, open, rename, rm, stat } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { AppExitCoordinator } from './appExitCoordinator'
import { CoreProcessManager } from './coreProcess'
import { createElectronUpdaterEngine } from './electronUpdaterEngine'
import { TermousTrayController } from './tray'
import { ApplicationUpdateRuntime } from './updateRuntime'

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
const ELECTRON_PROCESS_LOG_FILE = 'electron-process.log'
const ELECTRON_PROCESS_LOG_MAX_BYTES = 512 * 1024
const APPEARANCE_CACHE_FILE = 'appearance.json'
const BACKUP_EXTENSION = '.tobp'
const BACKUP_MAX_BYTES = 1 << 30
const BACKUP_PASSWORD_MAX_BYTES = 1024
const BACKUP_SELECTION_TTL_MS = 10 * 60 * 1000
const SSH_KEY_FILE_MAX_BYTES = 1 << 20
const SSH_KEY_FILE_NAME_MAX_BYTES = 255
const SSH_PUBLIC_KEY_SUFFIX = '.pub'
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
type AppLanguage = 'zh-CN' | 'en-US'

let win: BrowserWindow | null
let splashWin: BrowserWindow | null = null
let updateRuntime: ApplicationUpdateRuntime | null = null
let appTheme: AppTheme = 'dark'
let appLanguage: AppLanguage = 'zh-CN'
let mainWindowReady = false
let startupReadyRequested = false
let startupCompleted = false
let splashPhase: StartupPhase = 'core'
let splashStartedAt = 0
let startupCompletionTimer: NodeJS.Timeout | null = null

const exitCoordinator = new AppExitCoordinator({
  shutdownCore: (reason) => coreProcess.shutdownGracefully(reason),
  prepareForExit: prepareApplicationExit,
  closeAllWindows: closeAllApplicationWindows,
  quitApplication: () => app.quit(),
  reportError: (event, error) => {
    reportElectronProcessEvent(event, {
      message: error instanceof Error ? error.name : 'UnknownError',
    })
  },
})

interface PortabilityProgress {
  operation: 'export' | 'import'
  phase: 'selecting' | 'transferring' | 'finalizing' | 'complete'
  transferred_bytes?: number
  total_bytes?: number
}

interface PendingBackupSelection {
  id: string
  ownerId: number
  sourcePath: string
  fileName: string
  sizeBytes: number
  expiresAt: number
}

interface SSHKeyFileContentInput {
  suggestedName?: unknown
  content?: unknown
}

interface SSHKeyPairFileInput {
  suggestedName?: unknown
  privateKey?: unknown
  publicKey?: unknown
}

class SSHKeyFileOperationError extends Error {}

const pendingBackupSelections = new Map<string, PendingBackupSelection>()
const rendererRecoveryCooldownMs = 30_000

function reportElectronProcessEvent(event: string, details: Record<string, unknown>) {
  const line = `[termous:electron] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  })}`
  console.error(line)
  try {
    const logDirectory = app.getPath('logs')
    const logPath = path.join(logDirectory, ELECTRON_PROCESS_LOG_FILE)
    mkdirSync(logDirectory, { recursive: true })
    if (existsSync(logPath) && statSync(logPath).size >= ELECTRON_PROCESS_LOG_MAX_BYTES) {
      writeFileSync(logPath, '', 'utf8')
    }
    appendFileSync(logPath, `${line}\n`, 'utf8')
  } catch (error) {
    console.error(`[termous:electron] 无法写入进程诊断日志: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function startLocalCrashReporter() {
  try {
    crashReporter.start({
      productName: APP_NAME,
      uploadToServer: false,
      globalExtra: {
        runtime: VITE_DEV_SERVER_URL ? 'development' : 'production',
      },
    })
  } catch (error) {
    reportElectronProcessEvent('crash-reporter-start-failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function isRecoverableRendererFailure(reason: string) {
  return reason === 'abnormal-exit'
    || reason === 'crashed'
    || reason === 'oom'
    || reason === 'memory-eviction'
}

function registerRendererHealth(target: BrowserWindow) {
  const contents = target.webContents
  let disposed = false
  let lastRecoveryAt = 0
  let pendingRecoveryReason = ''
  let recoveryTimer: NodeJS.Timeout | null = null

  const clearRecoveryTimer = () => {
    if (!recoveryTimer) {
      return
    }
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
  const disposeRecovery = () => {
    if (disposed) {
      return
    }
    disposed = true
    pendingRecoveryReason = ''
    clearRecoveryTimer()
  }
  // 同一窗口只保留一个恢复任务，冷却期内的后续故障合并处理，避免连续 reload。
  const scheduleRecovery = (reason: string) => {
    if (disposed) {
      return
    }
    pendingRecoveryReason = reason
    const now = Date.now()
    const delay = Math.max(0, rendererRecoveryCooldownMs - (now - lastRecoveryAt))
    if (recoveryTimer) {
      reportElectronProcessEvent('renderer-recovery-coalesced', {
        reason,
        retry_after_ms: delay,
      })
      return
    }
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      if (disposed || target.isDestroyed() || contents.isDestroyed()) {
        pendingRecoveryReason = ''
        return
      }
      const recoveryReason = pendingRecoveryReason
      pendingRecoveryReason = ''
      lastRecoveryAt = Date.now()
      try {
        contents.reload()
        reportElectronProcessEvent('renderer-recovery-requested', {
          reason: recoveryReason,
        })
      } catch (error) {
        reportElectronProcessEvent('renderer-recovery-failed', {
          reason: recoveryReason,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }, delay)
    reportElectronProcessEvent('renderer-recovery-scheduled', {
      reason,
      delay_ms: delay,
    })
  }

  contents.on('render-process-gone', (_event, details) => {
    reportElectronProcessEvent('render-process-gone', {
      reason: details.reason,
      exit_code: details.exitCode,
    })
    if (!isRecoverableRendererFailure(details.reason)) {
      return
    }
    scheduleRecovery(details.reason)
  })
  contents.on('unresponsive', () => {
    reportElectronProcessEvent('renderer-unresponsive', {})
  })
  contents.on('responsive', () => {
    reportElectronProcessEvent('renderer-responsive', {})
  })
  contents.once('destroyed', disposeRecovery)
  target.once('closed', disposeRecovery)
}

// 个别显卡驱动异常时允许显式进入软件渲染安全模式，默认继续保留硬件加速性能。
if (process.env.TERMOUS_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
}
startLocalCrashReporter()

app.on('child-process-gone', (_event, details) => {
  reportElectronProcessEvent('child-process-gone', {
    type: details.type,
    reason: details.reason,
    exit_code: details.exitCode,
    service_name: details.serviceName,
    name: details.name,
  })
})

function emitPortabilityProgress(sender: WebContents, progress: PortabilityProgress) {
  if (!sender.isDestroyed()) {
    sender.send('portability:progress', progress)
  }
}

function validateBackupPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.trim() === '' || Buffer.byteLength(password, 'utf8') > BACKUP_PASSWORD_MAX_BYTES) {
    throw new Error('备份密码不能为空且不能超过 1024 字节')
  }
}

function pruneBackupSelections(ownerId?: number) {
  const now = Date.now()
  for (const [id, selection] of pendingBackupSelections) {
    if (selection.expiresAt <= now || selection.ownerId === ownerId) {
      pendingBackupSelections.delete(id)
    }
  }
}

async function portabilityResponseError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } }
    if (body.error?.message) {
      return new Error(body.error.message)
    }
  } catch {
    // 非 JSON 错误响应统一使用通用消息。
  }
  return new Error(`数据操作失败（${response.status}）`)
}

async function writeFileChunk(handle: Awaited<ReturnType<typeof open>>, value: Uint8Array) {
  let offset = 0
  while (offset < value.byteLength) {
    const result = await handle.write(value, offset, value.byteLength - offset)
    if (result.bytesWritten <= 0) {
      throw new Error('写入备份文件失败')
    }
    offset += result.bytesWritten
  }
}

function sshKeyFileError(code: string) {
  return new SSHKeyFileOperationError(code)
}

function normalizeSSHKeyFileError(error: unknown, fallback: string) {
  if (error instanceof SSHKeyFileOperationError) {
    return error
  }
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
    return sshKeyFileError('ssh_key_file_conflict')
  }
  return sshKeyFileError(fallback)
}

function isTrustedRendererURL(url: string) {
  try {
    const actual = new URL(url)
    if (VITE_DEV_SERVER_URL) {
      return actual.origin === new URL(VITE_DEV_SERVER_URL).origin
    }
    actual.hash = ''
    actual.search = ''
    return actual.href === pathToFileURL(path.join(RENDERER_DIST, 'index.html')).href
  } catch {
    return false
  }
}

function isTrustedMainIPCEvent(event: IpcMainInvokeEvent) {
  const target = win
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  const senderFrame = event.senderFrame
  return Boolean(
    target
    && !target.isDestroyed()
    && senderWindow === target
    && senderFrame
    && senderFrame === event.sender.mainFrame
    && isTrustedRendererURL(senderFrame.url)
  )
}

function trustedIPCWindow(event: IpcMainInvokeEvent) {
  const target = win
  if (
    !target ||
    !isTrustedMainIPCEvent(event)
  ) {
    throw sshKeyFileError('ssh_key_ipc_sender_not_allowed')
  }
  return target
}

function validateSSHKeyText(value: unknown, field: 'private' | 'public') {
  if (typeof value !== 'string' || !/\S/.test(value)) {
    throw sshKeyFileError(`ssh_${field}_key_required`)
  }
  if (Buffer.byteLength(value, 'utf8') > SSH_KEY_FILE_MAX_BYTES) {
    throw sshKeyFileError(`ssh_${field}_key_too_large`)
  }
  return value
}

function normalizeSuggestedKeyName(value: unknown, fallback: string) {
  if (value !== undefined && typeof value !== 'string') {
    throw sshKeyFileError('ssh_key_file_name_invalid')
  }
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > SSH_KEY_FILE_NAME_MAX_BYTES) {
    throw sshKeyFileError('ssh_key_file_name_invalid')
  }
  const input = typeof value === 'string' ? value.trim() : ''
  const withoutControls = Array.from(input, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127 ? '_' : character
  }).join('')
  const sanitized = withoutControls.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '')
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : fallback
}

async function pathExists(targetPath: string) {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function assertSSHKeyTargetsAvailable(targetPaths: string[]) {
  for (const targetPath of targetPaths) {
    if (await pathExists(targetPath)) {
      throw sshKeyFileError('ssh_key_file_conflict')
    }
  }
}

async function writeSSHKeyPartialFile(targetPath: string, content: string, mode: number) {
  const partialPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.partial`)
  const buffer = Buffer.from(content, 'utf8')
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(partialPath, 'wx', mode)
    await writeFileChunk(handle, buffer)
    await handle.sync()
    await handle.close()
    handle = null
    if (process.platform !== 'win32') {
      await chmod(partialPath, mode)
    }
    return partialPath
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
    }
    await rm(partialPath, { force: true }).catch(() => undefined)
    throw normalizeSSHKeyFileError(error, 'ssh_key_file_write_failed')
  } finally {
    buffer.fill(0)
  }
}

async function saveSSHKeyFile(targetPath: string, content: string, mode: number) {
  await assertSSHKeyTargetsAvailable([targetPath])
  let partialPath = await writeSSHKeyPartialFile(targetPath, content, mode)
  try {
    await assertSSHKeyTargetsAvailable([targetPath])
    await rename(partialPath, targetPath)
    partialPath = ''
  } catch (error) {
    if (partialPath) {
      await rm(partialPath, { force: true }).catch(() => undefined)
    }
    throw normalizeSSHKeyFileError(error, 'ssh_key_file_write_failed')
  }
}

async function saveSSHKeyPairFiles(privatePath: string, privateKey: string, publicKey: string) {
  const publicPath = `${privatePath}${SSH_PUBLIC_KEY_SUFFIX}`
  await assertSSHKeyTargetsAvailable([privatePath, publicPath])
  let privatePartialPath = ''
  let publicPartialPath = ''
  let privateCommitted = false
  let publicCommitted = false
  try {
    privatePartialPath = await writeSSHKeyPartialFile(privatePath, privateKey, 0o600)
    publicPartialPath = await writeSSHKeyPartialFile(publicPath, publicKey, 0o644)
    await assertSSHKeyTargetsAvailable([privatePath, publicPath])
    await rename(privatePartialPath, privatePath)
    privatePartialPath = ''
    privateCommitted = true
    await rename(publicPartialPath, publicPath)
    publicPartialPath = ''
    publicCommitted = true
    return publicPath
  } catch (error) {
    const cleanupTargets = [
      ...(privatePartialPath ? [privatePartialPath] : []),
      ...(publicPartialPath ? [publicPartialPath] : []),
      ...(privateCommitted ? [privatePath] : []),
      ...(publicCommitted ? [publicPath] : []),
    ]
    const cleanupResults = await Promise.allSettled(cleanupTargets.map((targetPath) => rm(targetPath, { force: true })))
    if (cleanupResults.some((result) => result.status === 'rejected')) {
      throw sshKeyFileError('ssh_key_pair_rollback_failed')
    }
    throw normalizeSSHKeyFileError(error, 'ssh_key_pair_write_failed')
  }
}

function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light'
}

function currentUpdateLanguage(): AppLanguage {
  const locale = app.getLocale()
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

function readTrayLanguage(value: unknown, fallback: AppLanguage): AppLanguage {
  if (
    value
    && typeof value === 'object'
    && 'language' in value
    && value.language === 'en-US'
  ) {
    return 'en-US'
  }
  if (
    value
    && typeof value === 'object'
    && 'language' in value
    && value.language === 'zh-CN'
  ) {
    return 'zh-CN'
  }
  return fallback
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
  if (exitCoordinator.isApplicationExiting()) {
    return
  }
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

function prepareApplicationExit() {
  if (startupCompletionTimer) {
    clearTimeout(startupCompletionTimer)
    startupCompletionTimer = null
  }
  closeSplashWindow()
  trayController.destroy()
}

function closeAllApplicationWindows() {
  updateRuntime?.closeWindow()
  closeSplashWindow()
  const target = win
  if (target && !target.isDestroyed()) {
    target.close()
  }
  for (const openWindow of BrowserWindow.getAllWindows()) {
    if (!openWindow.isDestroyed()) {
      openWindow.destroy()
    }
  }
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
  if (exitCoordinator.isApplicationExiting()) {
    return
  }
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
  registerRendererHealth(win)

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
    if (exitCoordinator.canCloseWindow('main')) {
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
  if (exitCoordinator.isApplicationExiting()) {
    return
  }
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
  await exitCoordinator.requestApplicationExit('tray')
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
    if (!currentWindow()) return false
    await exitCoordinator.requestApplicationExit('main_window')
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
    updateRuntime?.notifyStartupReady()
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
    updateRuntime?.updateAppearance(theme, appLanguage)
    applySplashPhase()
    return writeCachedAppTheme(theme)
  })
}

function registerTrayControls() {
  ipcMain.handle('tray:update-state', (_event, state: unknown) => {
    trayController.updateState(state ?? {})
    appLanguage = readTrayLanguage(state, appLanguage)
    updateRuntime?.updateAppearance(appTheme, appLanguage)
    return true
  })
}

function registerApplicationBuildControls() {
  ipcMain.handle('app:get-build-info', async (event) => {
    if (!isTrustedMainIPCEvent(event)) {
      throw new Error('app_build_info_sender_not_allowed')
    }
    const snapshot = updateRuntime?.getSnapshot()
    return {
      product_name: APP_NAME,
      version: app.getVersion(),
      core_version: await coreProcess.getRuntimeVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      update_channel: 'stable',
      update_supported: Boolean(snapshot && snapshot.phase !== 'unsupported'),
      update_support_reason: snapshot?.support_reason ?? (updateRuntime ? null : 'update_runtime_unavailable'),
    }
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

function registerSSHKeyFileControls() {
  ipcMain.handle('ssh-keys:select-private-key', async (event) => {
    const target = trustedIPCWindow(event)
    const selected = await dialog.showOpenDialog(target, {
      title: '导入 SSH 私钥',
      filters: [
        { name: 'SSH Private Key', extensions: ['pem', 'key', 'ppk'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (selected.canceled || selected.filePaths.length !== 1) {
      return { canceled: true }
    }
    const sourcePath = selected.filePaths[0]
    let handle: Awaited<ReturnType<typeof open>> | null = null
    let content: Buffer | null = null
    try {
      handle = await open(sourcePath, 'r')
      const sourceStat = await handle.stat()
      if (!sourceStat.isFile()) {
        throw sshKeyFileError('ssh_private_key_not_regular_file')
      }
      if (sourceStat.size <= 0) {
        throw sshKeyFileError('ssh_private_key_empty')
      }
      if (sourceStat.size > SSH_KEY_FILE_MAX_BYTES) {
        throw sshKeyFileError('ssh_private_key_too_large')
      }
      content = await handle.readFile()
      if (content.byteLength <= 0 || content.byteLength > SSH_KEY_FILE_MAX_BYTES) {
        throw sshKeyFileError(content.byteLength <= 0 ? 'ssh_private_key_empty' : 'ssh_private_key_too_large')
      }
      return {
        canceled: false,
        file_name: path.basename(sourcePath),
        private_key: content.toString('utf8'),
      }
    } catch (error) {
      throw normalizeSSHKeyFileError(error, 'ssh_private_key_read_failed')
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined)
      }
      content?.fill(0)
    }
  })

  ipcMain.handle('ssh-keys:save-public-key', async (event, input: SSHKeyFileContentInput) => {
    const target = trustedIPCWindow(event)
    if (!input || typeof input !== 'object') {
      throw sshKeyFileError('ssh_public_key_save_input_invalid')
    }
    const content = validateSSHKeyText(input.content, 'public')
    const baseName = normalizeSuggestedKeyName(input.suggestedName, 'id_ssh')
    const suggestedName = baseName.toLowerCase().endsWith(SSH_PUBLIC_KEY_SUFFIX)
      ? baseName
      : `${baseName}${SSH_PUBLIC_KEY_SUFFIX}`
    const selected = await dialog.showSaveDialog(target, {
      title: '保存 SSH 公钥',
      defaultPath: suggestedName,
      filters: [{ name: 'SSH Public Key', extensions: ['pub'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (selected.canceled || !selected.filePath) {
      return { canceled: true }
    }
    await saveSSHKeyFile(selected.filePath, content, 0o644)
    return { canceled: false, file_name: path.basename(selected.filePath) }
  })

  ipcMain.handle('ssh-keys:save-key-pair', async (event, input: SSHKeyPairFileInput) => {
    const target = trustedIPCWindow(event)
    if (!input || typeof input !== 'object') {
      throw sshKeyFileError('ssh_key_pair_save_input_invalid')
    }
    const privateKey = validateSSHKeyText(input.privateKey, 'private')
    const publicKey = validateSSHKeyText(input.publicKey, 'public')
    const suggestedName = normalizeSuggestedKeyName(input.suggestedName, 'id_ssh')
    const selected = await dialog.showSaveDialog(target, {
      title: '保存 SSH 密钥对',
      defaultPath: suggestedName,
      filters: [{ name: 'SSH Private Key', extensions: ['pem', 'key'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (selected.canceled || !selected.filePath) {
      return { canceled: true }
    }
    const publicPath = await saveSSHKeyPairFiles(selected.filePath, privateKey, publicKey)
    return {
      canceled: false,
      file_name: path.basename(selected.filePath),
      public_file_name: path.basename(publicPath),
    }
  })
}

function registerDataPortabilityControls() {
  const currentWindow = () => BrowserWindow.getFocusedWindow() ?? win
  ipcMain.handle('portability:export', async (event, password: unknown) => {
    validateBackupPassword(password)
    emitPortabilityProgress(event.sender, { operation: 'export', phase: 'selecting' })
    const focused = currentWindow()
    const options = {
      title: '导出 Termous 数据',
      defaultPath: `${randomUUID()}${BACKUP_EXTENSION}`,
      filters: [{ name: 'Termous Backup', extensions: ['tobp'] }],
      properties: ['showOverwriteConfirmation' as const],
    }
    const selected = focused ? await dialog.showSaveDialog(focused, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) {
      return { canceled: true }
    }
    const finalPath = selected.filePath.toLowerCase().endsWith(BACKUP_EXTENSION)
      ? selected.filePath
      : `${selected.filePath}${BACKUP_EXTENSION}`
    const partialPath = `${finalPath}.partial`
    const config = await coreProcess.initialize()
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      await rm(partialPath, { force: true })
      handle = await open(partialPath, 'wx', 0o600)
      const response = await fetch(new URL('/api/v1/data-portability/exports', config.apiBaseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiToken ? { 'X-Termous-Token': config.apiToken } : {}),
        },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        throw await portabilityResponseError(response)
      }
      if (!response.body) {
        throw new Error('备份导出流不可用')
      }
      const totalHeader = Number(response.headers.get('content-length') ?? 0)
      const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
      const reader = response.body.getReader()
      let transferredBytes = 0
      let chunk = await reader.read()
      while (!chunk.done) {
        await writeFileChunk(handle, chunk.value)
        transferredBytes += chunk.value.byteLength
        emitPortabilityProgress(event.sender, {
          operation: 'export', phase: 'transferring', transferred_bytes: transferredBytes, total_bytes: totalBytes,
        })
        chunk = await reader.read()
      }
      emitPortabilityProgress(event.sender, {
        operation: 'export', phase: 'finalizing', transferred_bytes: transferredBytes, total_bytes: totalBytes,
      })
      await handle.sync()
      await handle.close()
      handle = null
      await rename(partialPath, finalPath)
      emitPortabilityProgress(event.sender, {
        operation: 'export', phase: 'complete', transferred_bytes: transferredBytes, total_bytes: transferredBytes,
      })
      return { canceled: false, file_name: path.basename(finalPath) }
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined)
      }
      await rm(partialPath, { force: true }).catch(() => undefined)
      throw error
    }
  })

  ipcMain.handle('portability:select-import', async (event) => {
    pruneBackupSelections(event.sender.id)
    const focused = currentWindow()
    const options = {
      title: '导入 Termous 数据',
      filters: [{ name: 'Termous Backup', extensions: ['tobp'] }],
      properties: ['openFile' as const],
    }
    const selected = focused ? await dialog.showOpenDialog(focused, options) : await dialog.showOpenDialog(options)
    if (selected.canceled || selected.filePaths.length !== 1) {
      return { canceled: true }
    }
    const sourcePath = selected.filePaths[0]
    if (!sourcePath.toLowerCase().endsWith(BACKUP_EXTENSION)) {
      throw new Error('请选择 Termous 备份文件')
    }
    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > BACKUP_MAX_BYTES) {
      throw new Error('备份文件不可用')
    }
    const selection: PendingBackupSelection = {
      id: randomUUID(),
      ownerId: event.sender.id,
      sourcePath,
      fileName: path.basename(sourcePath),
      sizeBytes: sourceStat.size,
      expiresAt: Date.now() + BACKUP_SELECTION_TTL_MS,
    }
    pendingBackupSelections.set(selection.id, selection)
    return {
      canceled: false,
      selection_id: selection.id,
      file_name: selection.fileName,
      size_bytes: selection.sizeBytes,
    }
  })

  ipcMain.handle('portability:inspect', async (event, selectionId: unknown, password: unknown) => {
    validateBackupPassword(password)
    if (typeof selectionId !== 'string' || selectionId.trim() === '') {
      throw new Error('备份文件选择已失效')
    }
    const selection = pendingBackupSelections.get(selectionId)
    if (!selection || selection.ownerId !== event.sender.id || selection.expiresAt <= Date.now()) {
      pendingBackupSelections.delete(selectionId)
      throw new Error('备份文件选择已失效')
    }
    const sourcePath = selection.sourcePath
    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.size !== selection.sizeBytes || sourceStat.size <= 0 || sourceStat.size > BACKUP_MAX_BYTES) {
      pendingBackupSelections.delete(selectionId)
      throw new Error('备份文件已发生变化')
    }
    emitPortabilityProgress(event.sender, { operation: 'import', phase: 'transferring', transferred_bytes: 0, total_bytes: sourceStat.size })
    const boundary = `----termous-${randomBytes(18).toString('hex')}`
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\n${password}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="backup"; filename="backup.tobp"\r\n` +
      `Content-Type: application/vnd.termous.backup\r\n\r\n`,
      'utf8',
    )
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    const totalLength = prefix.byteLength + sourceStat.size + suffix.byteLength
    const config = await coreProcess.initialize()
    const upload = async function* () {
      yield prefix
      let transferredBytes = 0
      for await (const chunk of createReadStream(sourcePath)) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        transferredBytes += value.byteLength
        emitPortabilityProgress(event.sender, {
          operation: 'import', phase: 'transferring', transferred_bytes: transferredBytes, total_bytes: sourceStat.size,
        })
        yield value
      }
      yield suffix
    }
    try {
      const request = {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(totalLength),
          ...(config.apiToken ? { 'X-Termous-Token': config.apiToken } : {}),
        },
        body: Readable.from(upload()) as unknown as BodyInit,
        duplex: 'half' as const,
      }
      const response = await fetch(new URL('/api/v1/data-portability/imports', config.apiBaseUrl), request)
      if (!response.ok) {
        throw await portabilityResponseError(response)
      }
      emitPortabilityProgress(event.sender, {
        operation: 'import', phase: 'finalizing', transferred_bytes: sourceStat.size, total_bytes: sourceStat.size,
      })
      const inspection = await response.json()
      emitPortabilityProgress(event.sender, {
        operation: 'import', phase: 'complete', transferred_bytes: sourceStat.size, total_bytes: sourceStat.size,
      })
      pendingBackupSelections.delete(selectionId)
      return { canceled: false, inspection }
    } finally {
      prefix.fill(0)
    }
  })

  ipcMain.handle('portability:restart-after-restore', () => coreProcess.restartAfterRestore())
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void exitCoordinator.requestApplicationExit('window_all_closed')
  }
})

app.on('before-quit', (event) => {
  exitCoordinator.handleBeforeQuit(event)
})

app.on('activate', () => {
  if ((!win || win.isDestroyed()) && !exitCoordinator.isApplicationExiting()) {
    if (!startupCompleted) {
      createSplashWindow()
    }
    createWindow()
  }
})

app.whenReady().then(async () => {
  app.setName(APP_NAME)
  appTheme = readCachedAppTheme()
  appLanguage = currentUpdateLanguage()
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
  registerApplicationBuildControls()
  registerFilePickers()
  registerSSHKeyFileControls()
  registerDataPortabilityControls()
  try {
    updateRuntime = await ApplicationUpdateRuntime.create({
      engine: createElectronUpdaterEngine(),
      exitCoordinator,
      getMainWindow: () => win,
      isTrustedMainSender: isTrustedMainIPCEvent,
      rendererFilePath: path.join(RENDERER_DIST, 'index.html'),
      updatePreloadPath: path.join(__dirname, 'update-preload.cjs'),
      devServerURL: VITE_DEV_SERVER_URL,
      iconPath: APP_ICON,
      initialTheme: appTheme,
      initialLanguage: appLanguage,
      logger: {
        info: (event, details = {}) => reportElectronProcessEvent(event, details),
        error: (event, details = {}) => reportElectronProcessEvent(event, details),
      },
    })
  } catch (error) {
    reportElectronProcessEvent('update-runtime-initialize-failed', {
      message: error instanceof Error ? error.name : 'UnknownError',
    })
  }
  createSplashWindow()
  createWindow()
  trayController.initialize()
  void coreProcess.initialize().then(() => {
    updateSplashPhase(coreProcess.getFatal() ? 'error' : 'workspace')
  })
})
