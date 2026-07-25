import path from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import type { AppExitCoordinator } from './appExitCoordinator'
import {
  UpdateManager,
  UpdateOperationError,
  type UpdateEngine,
  type UpdateManagerLogger,
  type UpdatePreferences,
  type UpdatePreferencesPatch,
  type UpdateSnapshot,
} from './updateManager'
import {
  resolveAutomaticUpdateSchedule,
  UpdatePreferencesStore,
} from './updatePreferences'
import {
  UpdateInstallConfirmationAuthority,
  type UpdateInstallConfirmation,
  type UpdateInstallSummaryState,
  type UpdateRuntimeSummary,
} from './updateInstallConfirmation'
import {
  UpdateWindowController,
  type UpdateWindowIntent,
  type UpdateWindowLanguage,
  type UpdateWindowTheme,
} from './updateWindow'

const automaticCheckStartupDelayMs = 5_000
const automaticCheckMaximumTimerMs = 2_147_000_000
const releaseRepositoryURL = 'https://github.com/Countra/termous/releases'

export interface ApplicationUpdateRuntimeOptions {
  engine: UpdateEngine
  exitCoordinator: AppExitCoordinator
  getMainWindow(): BrowserWindow | null | undefined
  isTrustedMainSender(event: IpcMainInvokeEvent): boolean
  rendererFilePath: string
  updatePreloadPath: string
  devServerURL?: string
  iconPath?: string
  initialTheme: UpdateWindowTheme
  initialLanguage: UpdateWindowLanguage
  logger?: UpdateManagerLogger
}

type SenderRole = 'main' | 'update'

export class ApplicationUpdateRuntime {
  readonly manager: UpdateManager

  private readonly options: ApplicationUpdateRuntimeOptions
  private readonly preferencesStore: UpdatePreferencesStore
  private readonly installConfirmation = new UpdateInstallConfirmationAuthority()
  private readonly subscribers = new Map<number, WebContents>()
  private readonly subscriberDestroyListeners = new Map<number, () => void>()
  private readonly windowController: UpdateWindowController<UpdateSnapshot>
  private automaticCheckTimer: NodeJS.Timeout | null = null
  private automaticCheckAttempted = false
  private automaticCheckBlocked = false
  private automaticCheckInFlight = false
  private startupReady = false
  private disposed = false

  private constructor(
    options: ApplicationUpdateRuntimeOptions,
    preferencesStore: UpdatePreferencesStore,
    preferences: UpdatePreferences,
  ) {
    this.options = options
    this.preferencesStore = preferencesStore
    this.manager = new UpdateManager({
      engine: options.engine,
      installLifecycle: {
        prepareForInstall: () => this.prepareApplicationForInstall(),
        recoverFromInstallFailure: () => this.recoverFromInstallerFailure(),
      },
      preferences,
      logger: options.logger,
      persistPreferences: async (nextPreferences) => {
        if (!nextPreferences.last_checked_at) {
          return nextPreferences
        }
        return this.preferencesStore.recordSuccessfulCheck(nextPreferences.last_checked_at)
      },
    })
    this.windowController = new UpdateWindowController({
      createWindow: (windowOptions) => new BrowserWindow(windowOptions),
      devServerURL: options.devServerURL,
      getSnapshot: () => this.manager.getSnapshot(),
      iconPath: options.iconPath,
      initialLanguage: options.initialLanguage,
      initialTheme: options.initialTheme,
      isQuitting: () => options.exitCoordinator.isApplicationExiting(),
      onError: (error) => {
        options.logger?.error('update_window_failed', {
          message: safeErrorName(error),
        })
      },
      onStartDownload: () => this.manager.download(),
      platform: process.platform,
      preloadPath: options.updatePreloadPath,
      rendererFilePath: options.rendererFilePath,
      title: 'Termous Update',
    })
  }

  static async create(options: ApplicationUpdateRuntimeOptions) {
    const preferencesStore = new UpdatePreferencesStore(
      path.join(app.getPath('userData'), 'update-preferences.json'),
    )
    const preferences = await preferencesStore.load()
    const runtime = new ApplicationUpdateRuntime(options, preferencesStore, preferences)
    runtime.registerIPC()
    runtime.manager.subscribe((snapshot) => runtime.handleStateChanged(snapshot))
    return runtime
  }

  getSnapshot() {
    return this.manager.getSnapshot()
  }

  openWindow(intent: UpdateWindowIntent = 'inspect') {
    return Boolean(this.windowController.open(intent))
  }

  closeWindow() {
    return this.windowController.close()
  }

  updateAppearance(theme: UpdateWindowTheme, language: UpdateWindowLanguage) {
    this.windowController.updateAppearance(theme, language)
  }

  notifyStartupReady() {
    if (this.startupReady || this.disposed) {
      return
    }
    this.startupReady = true
    this.scheduleAutomaticCheck()
  }

  dispose() {
    this.disposed = true
    this.clearAutomaticCheckTimer()
    this.installConfirmation.clear()
    for (const [senderId, sender] of this.subscribers) {
      const listener = this.subscriberDestroyListeners.get(senderId)
      if (listener && !sender.isDestroyed()) {
        sender.removeListener('destroyed', listener)
      }
    }
    this.subscribers.clear()
    this.subscriberDestroyListeners.clear()
  }

  private registerIPC() {
    ipcMain.handle('app-update:get-state', (event) => {
      this.assertSender(event, ['main', 'update'])
      return this.manager.getSnapshot()
    })
    ipcMain.handle('app-update:get-preferences', (event) => {
      this.assertSender(event, ['main'])
      return { ...this.manager.getSnapshot().preferences }
    })
    ipcMain.handle('app-update:set-preferences', async (event, patch: unknown) => {
      this.assertSender(event, ['main'])
      const previous = this.manager.getSnapshot().preferences
      const preferences = await this.preferencesStore.update(patch)
      const snapshot = this.manager.setPreferences(preferences)
      if (
        preferences.automatic_check !== previous.automatic_check
        || preferences.check_interval !== previous.check_interval
      ) {
        this.automaticCheckAttempted = false
        this.automaticCheckBlocked = false
      }
      this.scheduleAutomaticCheck()
      return snapshot.preferences
    })
    ipcMain.handle('app-update:check', async (event) => {
      this.assertSender(event, ['main'])
      const snapshot = await this.manager.check('manual')
      if (snapshot.phase !== 'error') {
        this.automaticCheckAttempted = true
        this.automaticCheckBlocked = false
        this.scheduleAutomaticCheck()
      }
      return snapshot
    })
    ipcMain.handle('app-update:open-window', (event, intent: unknown) => {
      this.assertSender(event, ['main'])
      return this.openWindow(normalizeWindowIntent(intent))
    })
    ipcMain.handle('app-update:open-release-page', async (event) => {
      this.assertSender(event, ['main', 'update'])
      return this.openReleasePage()
    })
    ipcMain.handle('app-update:report-runtime-summary', (event, summary: unknown) => {
      this.assertSender(event, ['main'])
      const previous = this.installConfirmation.getSummaryState()
      const normalized = this.installConfirmation.updateSummary(summary)
      const next = this.installConfirmation.getSummaryState()
      if (
        previous.revision !== next.revision
        || previous.ready !== next.ready
      ) {
        this.notifyInstallSummaryChanged(next)
      }
      return normalized
    })
    ipcMain.handle('app-update:subscribe', (event) => {
      this.assertSender(event, ['main', 'update'])
      this.subscribers.set(event.sender.id, event.sender)
      if (!this.subscriberDestroyListeners.has(event.sender.id)) {
        const senderId = event.sender.id
        const listener = () => {
          this.subscribers.delete(senderId)
          this.subscriberDestroyListeners.delete(senderId)
        }
        this.subscriberDestroyListeners.set(senderId, listener)
        event.sender.once('destroyed', listener)
      }
      return this.manager.getSnapshot()
    })
    ipcMain.handle('app-update:unsubscribe', (event) => {
      this.assertSender(event, ['main', 'update'])
      this.subscribers.delete(event.sender.id)
      const listener = this.subscriberDestroyListeners.get(event.sender.id)
      if (listener) {
        event.sender.removeListener('destroyed', listener)
        this.subscriberDestroyListeners.delete(event.sender.id)
      }
      return true
    })
    ipcMain.handle('app-update:window-bootstrap', (event) => {
      this.assertSender(event, ['update'])
      return this.windowController.getBootstrap()
    })
    ipcMain.handle('app-update:download', (event) => {
      this.assertSender(event, ['update'])
      return this.manager.download()
    })
    ipcMain.handle('app-update:cancel-download', (event) => {
      this.assertSender(event, ['update'])
      return this.manager.cancelDownload()
    })
    ipcMain.handle('app-update:prepare-install', (event) => {
      this.assertSender(event, ['update'])
      return this.createInstallConfirmation()
    })
    ipcMain.handle('app-update:install', (event, confirmationToken: unknown) => {
      this.assertSender(event, ['update'])
      this.consumeInstallConfirmation(confirmationToken)
      return this.manager.install()
    })
    ipcMain.handle('app-update:window-minimize', (event) => {
      this.assertSender(event, ['update'])
      return this.windowController.minimize()
    })
    ipcMain.handle('app-update:window-close', (event) => {
      this.assertSender(event, ['update'])
      return this.windowController.close()
    })
  }

  private assertSender(event: IpcMainInvokeEvent, allowedRoles: SenderRole[]) {
    const senderFrame = event.senderFrame
    if (!senderFrame || senderFrame !== event.sender.mainFrame) {
      throw new Error('update_ipc_sender_not_allowed')
    }
    const role = this.senderRole(event)
    if (!role || !allowedRoles.includes(role)) {
      throw new Error('update_ipc_sender_not_allowed')
    }
    return role
  }

  private senderRole(event: IpcMainInvokeEvent): SenderRole | null {
    if (this.options.isTrustedMainSender(event)) {
      return 'main'
    }
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (
      !senderWindow
      || !this.windowController.ownsWebContents(event.sender.id)
      || !isUpdateSurfaceURL(event.senderFrame?.url)
    ) {
      return null
    }
    return 'update'
  }

  private handleStateChanged(snapshot: UpdateSnapshot) {
    this.installConfirmation.reconcile(snapshot)
    for (const [senderId, sender] of this.subscribers) {
      if (sender.isDestroyed()) {
        this.subscribers.delete(senderId)
        continue
      }
      sender.send('app-update:state-changed', snapshot)
    }
    this.scheduleAutomaticCheck()
  }

  private notifyInstallSummaryChanged(state: UpdateInstallSummaryState) {
    for (const [senderId, sender] of this.subscribers) {
      if (sender.isDestroyed()) {
        this.subscribers.delete(senderId)
        continue
      }
      sender.send('app-update:install-summary-changed', state)
    }
  }

  private async openReleasePage() {
    const releaseURL = this.manager.getSnapshot().release_url ?? releaseRepositoryURL
    if (!isTrustedReleaseURL(releaseURL)) {
      return false
    }
    try {
      await shell.openExternal(releaseURL)
      return true
    } catch (error) {
      this.options.logger?.error('update_release_page_open_failed', {
        message: safeErrorName(error),
      })
      return false
    }
  }

  private createInstallConfirmation(): UpdateInstallConfirmation {
    return this.installConfirmation.issue(this.manager.getSnapshot())
  }

  private consumeInstallConfirmation(value: unknown) {
    this.installConfirmation.consume(value, this.manager.getSnapshot())
  }

  private async prepareApplicationForInstall() {
    const result = await this.options.exitCoordinator.prepareUpdateInstall()
    if (result.status === 'ready_to_install') {
      return
    }
    throw new UpdateOperationError(
      'UPDATE_CORE_SHUTDOWN_FAILED',
      '核心服务未能安全退出，更新尚未安装',
      result.status === 'core_shutdown_failed',
    )
  }

  private async recoverFromInstallerFailure() {
    this.options.exitCoordinator.handleUpdateInstallerFailure(
      new Error('update_installer_launch_failed'),
    )
  }

  private scheduleAutomaticCheck() {
    this.clearAutomaticCheckTimer()
    if (
      !this.startupReady
      || this.disposed
      || this.automaticCheckBlocked
      || this.automaticCheckInFlight
    ) {
      return
    }
    const snapshot = this.manager.getSnapshot()
    if (!snapshot.preferences.automatic_check || snapshot.phase === 'unsupported') {
      return
    }
    if (
      snapshot.phase === 'checking'
      || snapshot.phase === 'downloading'
      || snapshot.phase === 'downloaded'
      || snapshot.phase === 'preparing_install'
      || snapshot.phase === 'installing'
    ) {
      return
    }
    const schedule = resolveAutomaticUpdateSchedule(snapshot.preferences, {
      now: Date.now(),
      checked_this_launch: this.automaticCheckAttempted,
    })
    if (!schedule.next_check_at) {
      return
    }
    const dueAt = Date.parse(schedule.next_check_at)
    const delay = schedule.due
      ? automaticCheckStartupDelayMs
      : Math.max(automaticCheckStartupDelayMs, dueAt - Date.now())
    this.automaticCheckTimer = setTimeout(() => {
      this.automaticCheckTimer = null
      this.automaticCheckAttempted = true
      this.automaticCheckInFlight = true
      const previousCheckedAt = this.manager.getSnapshot().checked_at
      void this.manager.check('automatic')
        .then((result) => {
          this.automaticCheckBlocked = (
            result.phase === 'error'
            && result.checked_at === previousCheckedAt
          )
        })
        .finally(() => {
          this.automaticCheckInFlight = false
          this.scheduleAutomaticCheck()
        })
    }, Math.min(delay, automaticCheckMaximumTimerMs))
    this.automaticCheckTimer.unref?.()
  }

  private clearAutomaticCheckTimer() {
    if (!this.automaticCheckTimer) {
      return
    }
    clearTimeout(this.automaticCheckTimer)
    this.automaticCheckTimer = null
  }
}

function normalizeWindowIntent(value: unknown): UpdateWindowIntent {
  return value === 'start_download' ? 'start_download' : 'inspect'
}

function isUpdateSurfaceURL(value: string | undefined) {
  if (!value) {
    return false
  }
  try {
    return new URL(value).searchParams.get('surface') === 'update'
  } catch {
    return false
  }
}

function isTrustedReleaseURL(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && (
        url.pathname === '/Countra/termous/releases'
        || url.pathname.startsWith('/Countra/termous/releases/')
      )
    )
  } catch {
    return false
  }
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError'
}

export type {
  UpdateInstallConfirmation,
  UpdatePreferencesPatch,
  UpdateRuntimeSummary,
  UpdateSnapshot,
}
