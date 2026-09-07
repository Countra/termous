import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import type { AppExitCoordinator } from './appExitCoordinator'
import { AutomaticUpdateRetryPolicy } from './updateAutomaticCheckPolicy'
import {
  UpdateManager,
  UpdateOperationError,
  type UpdateApplicationInfo,
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
  normalizeRuntimeSummary,
  UpdateInstallConfirmationAuthority,
  type UpdateInstallConfirmation,
  type UpdateInstallSummaryState,
  type UpdateRuntimeSummary,
} from './updateInstallConfirmation'
import {
  decideRuntimeSummaryReport,
  normalizeRuntimeSummaryReportContext,
  type UpdateRuntimeSummaryRefreshIdentity,
} from './updateRuntimeSummaryRefresh'
import {
  UpdateWindowController,
  type UpdateWindowLanguage,
  type UpdateWindowTheme,
} from './updateWindow'

const automaticCheckStartupDelayMs = 5_000
const automaticCheckMaximumTimerMs = 2_147_000_000
const installSummaryRefreshTimeoutMs = 5_000
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
  getApplicationInfo(): Promise<UpdateApplicationInfo>
  openReleasePage?(url: string): Promise<void> | void
  releasePageUrl?: string
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
  private installSummaryExpiryTimer: NodeJS.Timeout | null = null
  private automaticCheckAttempted = false
  private automaticCheckInFlight = false
  private manualCheckInFlight = false
  private manualCheckPromise: Promise<UpdateSnapshot> | null = null
  private readonly automaticCheckRetry = new AutomaticUpdateRetryPolicy()
  private mainSummaryWindow: BrowserWindow | null = null
  private mainSummarySenderId: number | null = null
  private mainSummaryDocumentEpoch: string | null = null
  private mainSummaryWindowCleanup: (() => void) | null = null
  private installSummaryRefreshPromise: Promise<void> | null = null
  private installSummaryRefreshResolve: (() => void) | null = null
  private installSummaryRefreshReject: ((error: Error) => void) | null = null
  private installSummaryRefreshTimer: NodeJS.Timeout | null = null
  private installSummaryRefreshSenderId: number | null = null
  private installSummaryRefreshRequestId: string | null = null
  private installSummaryRefreshDocumentEpoch: string | null = null
  private activeInstallConfirmation: UpdateInstallConfirmation | null = null
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
      canClose: () => {
        const phase = this.manager.getSnapshot().phase
        return phase !== 'preparing_install' && phase !== 'installing'
      },
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
      openReleasePage: options.openReleasePage,
      platform: process.platform,
      preloadPath: options.updatePreloadPath,
      releasePageUrl: options.releasePageUrl,
      rendererFilePath: options.rendererFilePath,
      title: 'About Termous',
    })
  }

  static async create(options: ApplicationUpdateRuntimeOptions) {
    const preferencesStore = new UpdatePreferencesStore(
      path.join(app.getPath('userData'), 'update-preferences.json'),
      {
        onReadError: (error) => {
          options.logger?.error('update_preferences_load_failed', {
            message: safeErrorName(error),
          })
        },
      },
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

  openWindow() {
    void this.requestFreshInstallSummary().catch(() => {
      // 主窗口尚未完成初始化时仍允许打开关于窗口，由界面展示摘要未就绪状态。
    })
    return Boolean(this.windowController.open())
  }

  closeWindow() {
    return this.windowController.close()
  }

  updateAppearance(theme: UpdateWindowTheme, language: UpdateWindowLanguage) {
    this.windowController.updateAppearance(theme, language)
  }

  bindMainWindow(target: BrowserWindow) {
    this.unbindMainSummaryWindow()
    this.mainSummaryWindow = target
    this.mainSummaryDocumentEpoch = randomUUID()
    this.invalidateInstallSummary()

    const contents = target.webContents
    const senderId = contents.id
    const isCurrentBinding = () => (
      !this.disposed
      && this.mainSummaryWindow === target
      && !target.isDestroyed()
      && !contents.isDestroyed()
    )
    const invalidate = () => {
      if (!isCurrentBinding()) {
        return
      }
      this.rejectInstallSummaryRefresh(
        new Error('update_runtime_summary_document_invalidated'),
      )
      this.mainSummarySenderId = null
      this.mainSummaryDocumentEpoch = randomUUID()
      this.invalidateInstallSummary()
    }
    const activate = () => {
      if (isCurrentBinding()) {
        this.mainSummarySenderId = senderId
      }
    }
    const handleNavigationStart = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (details.isMainFrame && !details.isSameDocument) {
        invalidate()
      }
    }
    const disposeBinding = () => {
      contents.removeListener('did-start-navigation', handleNavigationStart)
      contents.removeListener('did-finish-load', activate)
      contents.removeListener('render-process-gone', invalidate)
      contents.removeListener('unresponsive', invalidate)
      contents.removeListener('responsive', activate)
      contents.removeListener('destroyed', disposeBinding)
      target.removeListener('closed', disposeBinding)
      if (this.mainSummaryWindow === target) {
        this.rejectInstallSummaryRefresh(
          new Error('update_runtime_summary_document_closed'),
        )
        this.mainSummaryWindow = null
        this.mainSummarySenderId = null
        this.mainSummaryDocumentEpoch = null
        this.mainSummaryWindowCleanup = null
        this.invalidateInstallSummary()
      }
    }

    contents.on('did-start-navigation', handleNavigationStart)
    contents.on('did-finish-load', activate)
    contents.on('render-process-gone', invalidate)
    contents.on('unresponsive', invalidate)
    contents.on('responsive', activate)
    contents.once('destroyed', disposeBinding)
    target.once('closed', disposeBinding)
    this.mainSummaryWindowCleanup = disposeBinding
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
    this.clearInstallSummaryExpiryTimer()
    this.rejectInstallSummaryRefresh(
      new Error('update_runtime_summary_disposed'),
    )
    this.unbindMainSummaryWindow()
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
        this.automaticCheckRetry.reset()
      }
      this.scheduleAutomaticCheck()
      return snapshot.preferences
    })
    ipcMain.handle('app-update:check', async (event) => {
      this.assertSender(event, ['update'])
      return await this.requestManualCheck()
    })
    ipcMain.handle('app-update:get-application-info', (event) => {
      this.assertSender(event, ['update'])
      return this.options.getApplicationInfo()
    })
    ipcMain.handle('app-update:open-window', (event) => {
      this.assertSender(event, ['main'])
      return this.openWindow()
    })
    ipcMain.handle('app-update:report-runtime-summary', (
      event,
      summary: unknown,
      context: unknown,
    ) => {
      this.assertSender(event, ['main'])
      if (event.sender.id !== this.mainSummarySenderId) {
        throw new Error('update_runtime_summary_sender_not_ready')
      }
      const normalized = normalizeRuntimeSummary(summary)
      const reportContext = normalizeRuntimeSummaryReportContext(context)
      if (context !== undefined && !reportContext) {
        throw new Error('update_runtime_summary_context_invalid')
      }
      const decision = decideRuntimeSummaryReport({
        senderId: event.sender.id,
        currentSenderId: this.mainSummarySenderId,
        currentDocumentEpoch: this.mainSummaryDocumentEpoch,
        context: reportContext,
        refresh: this.getInstallSummaryRefreshIdentity(),
      })
      if (!decision.accept) {
        return normalized
      }
      const previous = this.installConfirmation.getSummaryState()
      const accepted = this.installConfirmation.updateSummary(normalized)
      const next = this.installConfirmation.getSummaryState()
      this.scheduleInstallSummaryExpiry()
      if (decision.completes_refresh && reportContext?.request_id) {
        this.completeInstallSummaryRefresh(
          event.sender.id,
          reportContext.request_id,
          reportContext.document_epoch,
        )
      }
      if (
        previous.revision !== next.revision
        || previous.ready !== next.ready
      ) {
        this.notifyInstallSummaryChanged(next)
      }
      return accepted
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
    ipcMain.handle('app-update:prepare-install', async (event) => {
      this.assertSender(event, ['update'])
      return await this.createInstallConfirmation()
    })
    ipcMain.handle('app-update:install', (event, confirmationToken: unknown) => {
      this.assertSender(event, ['update'])
      return this.installWithConfirmation(confirmationToken)
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

  private async createInstallConfirmation(): Promise<UpdateInstallConfirmation> {
    await this.requestFreshInstallSummary()
    return this.installConfirmation.issue(this.manager.getSnapshot())
  }

  private consumeInstallConfirmation(value: unknown) {
    return this.installConfirmation.consume(value, this.manager.getSnapshot())
  }

  private installWithConfirmation(value: unknown) {
    if (this.activeInstallConfirmation) {
      return Promise.reject(new Error('update_install_confirmation_invalid'))
    }
    const confirmation = this.consumeInstallConfirmation(value)
    this.activeInstallConfirmation = confirmation
    let operation: Promise<UpdateSnapshot>
    try {
      operation = this.manager.install()
    } catch (error) {
      this.activeInstallConfirmation = null
      throw error
    }
    return operation.finally(() => {
      if (this.activeInstallConfirmation === confirmation) {
        this.activeInstallConfirmation = null
      }
    })
  }

  private async prepareApplicationForInstall() {
    const confirmation = this.activeInstallConfirmation
    try {
      if (!confirmation) {
        throw new Error('update_install_confirmation_missing')
      }
      this.installConfirmation.assertSummaryRevisionCurrent(
        confirmation.summary_revision,
      )
    } catch {
      throw new UpdateOperationError(
        'UPDATE_INSTALL_SUMMARY_STALE',
        '安装影响信息已变化，请重新确认后安装',
        true,
      )
    }
    const result = await this.options.exitCoordinator.prepareUpdateInstall()
    if (
      result.status === 'ready_to_install'
      && !this.options.exitCoordinator.isApplicationExiting()
    ) {
      return
    }
    throw new UpdateOperationError(
      'UPDATE_CORE_SHUTDOWN_FAILED',
      '核心服务未能安全退出，更新尚未安装',
      result.status === 'core_shutdown_failed',
    )
  }

  private async recoverFromInstallerFailure() {
    return await this.options.exitCoordinator.handleUpdateInstallerFailure(
      new Error('update_installer_launch_failed'),
    )
  }

  private requestManualCheck(): Promise<UpdateSnapshot> {
    if (this.manualCheckPromise) {
      return this.manualCheckPromise
    }
    if (this.automaticCheckInFlight) {
      return this.manager.check('manual')
    }

    this.clearAutomaticCheckTimer()
    this.manualCheckInFlight = true
    const before = this.manager.getSnapshot()
    const previousCheckedAt = before.checked_at
    const managerOperation = this.manager.check('manual')
    const after = this.manager.getSnapshot()
    const ownsAttempt = (
      after.phase === 'checking'
      && after.operation_generation !== before.operation_generation
    )
    if (!ownsAttempt) {
      this.manualCheckInFlight = false
      this.scheduleAutomaticCheck()
      return managerOperation
    }

    this.automaticCheckAttempted = true
    const operation = managerOperation
      .then((snapshot) => {
        this.recordManualCheckResult(snapshot, previousCheckedAt)
        return snapshot
      })
      .catch((error) => {
        this.automaticCheckRetry.deferAfterManualFailure(Date.now())
        throw error
      })
      .finally(() => {
        this.manualCheckInFlight = false
        if (this.manualCheckPromise === operation) {
          this.manualCheckPromise = null
        }
        this.scheduleAutomaticCheck()
      })
    this.manualCheckPromise = operation
    return operation
  }

  private scheduleAutomaticCheck() {
    this.clearAutomaticCheckTimer()
    if (
      !this.startupReady
      || this.disposed
      || this.automaticCheckInFlight
      || this.manualCheckInFlight
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
    const now = Date.now()
    const retryAt = this.automaticCheckRetry.getRetryAt()
    let dueAt = retryAt
    if (dueAt === null) {
      const schedule = resolveAutomaticUpdateSchedule(snapshot.preferences, {
        now,
        checked_this_launch: this.automaticCheckAttempted,
      })
      if (!schedule.next_check_at) {
        return
      }
      dueAt = Date.parse(schedule.next_check_at)
    }
    const delay = Math.max(automaticCheckStartupDelayMs, dueAt - now)
    this.automaticCheckTimer = setTimeout(() => {
      this.automaticCheckTimer = null
      this.automaticCheckAttempted = true
      this.automaticCheckInFlight = true
      const previousCheckedAt = this.manager.getSnapshot().checked_at
      void this.manager.check('automatic')
        .then((result) => {
          this.recordCheckResult(result, previousCheckedAt)
        })
        .catch((error) => {
          this.automaticCheckRetry.recordFailure(Date.now())
          this.options.logger?.error('automatic_update_check_failed', {
            message: safeErrorName(error),
          })
        })
        .finally(() => {
          this.automaticCheckInFlight = false
          this.scheduleAutomaticCheck()
        })
    }, Math.min(delay, automaticCheckMaximumTimerMs))
    this.automaticCheckTimer.unref?.()
  }

  private recordCheckResult(
    snapshot: UpdateSnapshot,
    previousCheckedAt: string | null,
  ) {
    if (
      snapshot.phase === 'error'
      && snapshot.checked_at === previousCheckedAt
    ) {
      this.automaticCheckRetry.recordFailure(Date.now())
      return
    }
    this.automaticCheckRetry.reset()
  }

  private recordManualCheckResult(
    snapshot: UpdateSnapshot,
    previousCheckedAt: string | null,
  ) {
    if (
      snapshot.phase === 'error'
      && snapshot.checked_at === previousCheckedAt
    ) {
      this.automaticCheckRetry.deferAfterManualFailure(Date.now())
      return
    }
    this.automaticCheckRetry.reset()
  }

  private scheduleInstallSummaryExpiry() {
    this.clearInstallSummaryExpiryTimer()
    const expiresAt = this.installConfirmation.getSummaryExpiresAt()
    if (expiresAt === null) {
      return
    }
    const delay = Math.max(0, expiresAt - Date.now())
    this.installSummaryExpiryTimer = setTimeout(() => {
      this.installSummaryExpiryTimer = null
      const currentExpiry = this.installConfirmation.getSummaryExpiresAt()
      if (currentExpiry !== null && currentExpiry > Date.now()) {
        this.scheduleInstallSummaryExpiry()
        return
      }
      this.invalidateInstallSummary()
    }, delay)
    this.installSummaryExpiryTimer.unref?.()
  }

  private requestFreshInstallSummary() {
    if (this.installSummaryRefreshPromise) {
      return this.installSummaryRefreshPromise
    }
    const target = this.mainSummaryWindow
    const senderId = this.mainSummarySenderId
    const documentEpoch = this.mainSummaryDocumentEpoch
    if (
      this.disposed
      || senderId === null
      || documentEpoch === null
      || !target
      || target.isDestroyed()
      || target.webContents.isDestroyed()
      || target.webContents.id !== senderId
    ) {
      return Promise.reject(new Error('update_runtime_summary_sender_not_ready'))
    }

    let resolvePromise!: () => void
    let rejectPromise!: (error: Error) => void
    const base = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const operation = base.finally(() => {
      if (this.installSummaryRefreshPromise !== operation) {
        return
      }
      if (this.installSummaryRefreshTimer) {
        clearTimeout(this.installSummaryRefreshTimer)
      }
      this.installSummaryRefreshPromise = null
      this.installSummaryRefreshResolve = null
      this.installSummaryRefreshReject = null
      this.installSummaryRefreshTimer = null
      this.installSummaryRefreshSenderId = null
      this.installSummaryRefreshRequestId = null
      this.installSummaryRefreshDocumentEpoch = null
    })
    const requestId = randomUUID()
    this.installSummaryRefreshPromise = operation
    this.installSummaryRefreshResolve = resolvePromise
    this.installSummaryRefreshReject = rejectPromise
    this.installSummaryRefreshSenderId = senderId
    this.installSummaryRefreshRequestId = requestId
    this.installSummaryRefreshDocumentEpoch = documentEpoch
    this.installSummaryRefreshTimer = setTimeout(() => {
      this.rejectInstallSummaryRefresh(
        new Error('update_runtime_summary_refresh_timeout'),
      )
    }, installSummaryRefreshTimeoutMs)
    this.installSummaryRefreshTimer.unref?.()

    try {
      target.webContents.send('app-update:runtime-summary-requested', {
        request_id: requestId,
        document_epoch: documentEpoch,
      })
    } catch {
      this.rejectInstallSummaryRefresh(
        new Error('update_runtime_summary_request_failed'),
      )
    }
    return operation
  }

  private completeInstallSummaryRefresh(
    senderId: number,
    requestId: string,
    documentEpoch: string,
  ) {
    if (
      senderId === this.installSummaryRefreshSenderId
      && requestId === this.installSummaryRefreshRequestId
      && documentEpoch === this.installSummaryRefreshDocumentEpoch
      && documentEpoch === this.mainSummaryDocumentEpoch
    ) {
      const resolve = this.installSummaryRefreshResolve
      this.installSummaryRefreshResolve = null
      this.clearInstallSummaryRefreshIdentity()
      resolve?.()
    }
  }

  private getInstallSummaryRefreshIdentity(): UpdateRuntimeSummaryRefreshIdentity | null {
    const senderId = this.installSummaryRefreshSenderId
    const requestId = this.installSummaryRefreshRequestId
    const documentEpoch = this.installSummaryRefreshDocumentEpoch
    if (
      senderId === null
      || requestId === null
      || documentEpoch === null
    ) {
      return null
    }
    return {
      senderId,
      requestId,
      documentEpoch,
    }
  }

  private rejectInstallSummaryRefresh(error: Error) {
    const reject = this.installSummaryRefreshReject
    this.installSummaryRefreshReject = null
    this.clearInstallSummaryRefreshIdentity()
    reject?.(error)
  }

  private clearInstallSummaryRefreshIdentity() {
    this.installSummaryRefreshSenderId = null
    this.installSummaryRefreshRequestId = null
    this.installSummaryRefreshDocumentEpoch = null
  }

  private invalidateInstallSummary() {
    this.clearInstallSummaryExpiryTimer()
    const previous = this.installConfirmation.getSummaryState()
    const next = this.installConfirmation.invalidateSummary()
    if (
      previous.revision !== next.revision
      || previous.ready !== next.ready
    ) {
      this.notifyInstallSummaryChanged(next)
    }
  }

  private clearInstallSummaryExpiryTimer() {
    if (!this.installSummaryExpiryTimer) {
      return
    }
    clearTimeout(this.installSummaryExpiryTimer)
    this.installSummaryExpiryTimer = null
  }

  private unbindMainSummaryWindow() {
    const cleanup = this.mainSummaryWindowCleanup
    this.mainSummaryWindowCleanup = null
    cleanup?.()
  }

  private clearAutomaticCheckTimer() {
    if (!this.automaticCheckTimer) {
      return
    }
    clearTimeout(this.automaticCheckTimer)
    this.automaticCheckTimer = null
  }
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

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError'
}

export type {
  UpdateInstallConfirmation,
  UpdatePreferencesPatch,
  UpdateRuntimeSummary,
  UpdateSnapshot,
}
