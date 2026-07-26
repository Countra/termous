import type { CoreShutdownReason } from './coreProcess'

export type { CoreShutdownReason } from './coreProcess'

export type AppExitSource =
  | 'main_window'
  | 'tray'
  | 'window_all_closed'
  | 'before_quit'

export type AppWindowRole = 'main' | 'splash' | 'update'

export interface AppExitResult {
  mode: 'application_exit'
  source: AppExitSource
  coreStopped: boolean
}

export type UpdateInstallResult =
  | { status: 'ready_to_install' }
  | { status: 'core_shutdown_failed' }
  | { status: 'application_exit_in_progress' }

export interface AppBeforeQuitEvent {
  preventDefault(): void
}

export interface AppExitCoordinatorDependencies {
  shutdownCore(reason: CoreShutdownReason): Promise<boolean>
  prepareForExit(): void
  recoverAfterFailedUpdateInstall?(): Promise<boolean>
  closeAllWindows(): void
  quitApplication(): void
  reportError?(event: string, error: unknown): void
}

export class AppExitCoordinator {
  private readonly dependencies: AppExitCoordinatorDependencies
  private appExitPromise: Promise<AppExitResult> | null = null
  private updateInstallPromise: Promise<UpdateInstallResult> | null = null
  private updateRecoveryPromise: Promise<boolean> | null = null
  private applicationExitCoreStopPromise: Promise<boolean> | null = null
  private exitRequested = false
  private nativeQuitAllowed = false
  private windowTeardownStarted = false
  private preparedForExit = false
  private windowsClosed = false
  private quitRequested = false

  constructor(dependencies: AppExitCoordinatorDependencies) {
    this.dependencies = dependencies
  }

  requestApplicationExit(source: AppExitSource): Promise<AppExitResult> {
    if (this.appExitPromise) {
      return this.appExitPromise
    }
    // 退出请求必须同步生效，避免等待 Core 收口期间又创建或显示窗口。
    this.exitRequested = true
    const pending = this.performApplicationExit(source)
    this.appExitPromise = pending
    return pending
  }

  prepareUpdateInstall(): Promise<UpdateInstallResult> {
    if (this.appExitPromise || this.nativeQuitAllowed) {
      return Promise.resolve({ status: 'application_exit_in_progress' })
    }
    if (this.updateInstallPromise) {
      return this.updateInstallPromise
    }
    const pending = this.performUpdateInstall().finally(() => {
      if (this.updateInstallPromise === pending && !this.nativeQuitAllowed) {
        this.updateInstallPromise = null
      }
    })
    this.updateInstallPromise = pending
    return pending
  }

  handleBeforeQuit(event: AppBeforeQuitEvent) {
    if (this.nativeQuitAllowed) {
      this.windowTeardownStarted = true
      this.prepareForExitOnce()
      return true
    }
    event.preventDefault()
    void this.requestApplicationExit('before_quit')
    return false
  }

  canCloseWindow(role: AppWindowRole) {
    return (
      role === 'update'
      || this.exitRequested
      || this.windowTeardownStarted
    )
  }

  isExitCommitted() {
    return (
      this.nativeQuitAllowed
      && (this.exitRequested || this.windowTeardownStarted)
    )
  }

  isApplicationExiting() {
    return this.exitRequested || this.windowTeardownStarted
  }

  handleUpdateInstallerFailure(error: unknown): Promise<boolean> {
    if (this.updateRecoveryPromise) {
      return this.updateRecoveryPromise
    }
    this.dependencies.reportError?.('update-installer-launch-failed', error)
    // 安装器失败后可能重新启动 Core；恢复完成前必须重新拦截原生退出。
    this.nativeQuitAllowed = false
    const pending = this.performFailedUpdateRecovery().finally(() => {
      if (this.updateRecoveryPromise === pending) {
        this.updateRecoveryPromise = null
      }
    })
    this.updateRecoveryPromise = pending
    return pending
  }

  private async performFailedUpdateRecovery() {
    if (
      this.appExitPromise
      || this.exitRequested
      || this.windowTeardownStarted
    ) {
      await this.finishFailedUpdateRecovery()
      return false
    }
    try {
      const recovered = await this.dependencies.recoverAfterFailedUpdateInstall?.()
      if (
        recovered
        && !this.appExitPromise
        && !this.exitRequested
        && !this.windowTeardownStarted
      ) {
        // 恢复成功后必须清除安装准备状态，后续重试才能重新关闭 Core 并执行退出准备。
        this.nativeQuitAllowed = false
        this.preparedForExit = false
        this.updateInstallPromise = null
        return true
      }
    } catch (recoveryError) {
      this.dependencies.reportError?.(
        'update-installer-failure-recovery-failed',
        recoveryError,
      )
    }
    // 恢复失败时继续退出，避免留下 Core 已停止但界面仍可操作的半关闭应用。
    await this.finishFailedUpdateRecovery()
    return false
  }

  private async finishFailedUpdateRecovery() {
    await this.stopCoreForApplicationExit()
    this.nativeQuitAllowed = true
    this.windowTeardownStarted = true
    this.prepareForExitOnce()
    this.closeAllWindowsOnce()
    this.quitApplicationOnce()
  }

  private async performApplicationExit(source: AppExitSource): Promise<AppExitResult> {
    let coreStopped = false
    const updateRecoveryPromise = this.updateRecoveryPromise
    if (updateRecoveryPromise) {
      await updateRecoveryPromise
      coreStopped = await this.stopCoreForApplicationExit()
    } else if (this.updateInstallPromise) {
      const updateResult = await this.updateInstallPromise
      coreStopped = updateResult.status === 'ready_to_install'
    }

    if (!coreStopped) {
      coreStopped = await this.stopCoreForApplicationExit()
    }
    this.nativeQuitAllowed = true
    this.windowTeardownStarted = true
    this.prepareForExitOnce()
    this.closeAllWindowsOnce()
    this.quitApplicationOnce()
    return { mode: 'application_exit', source, coreStopped }
  }

  private async performUpdateInstall(): Promise<UpdateInstallResult> {
    const coreStopped = await this.stopCore('application_update')
    if (!coreStopped) {
      return { status: 'core_shutdown_failed' }
    }

    this.nativeQuitAllowed = true
    this.prepareForExitOnce()
    return { status: 'ready_to_install' }
  }

  private async stopCore(reason: CoreShutdownReason) {
    try {
      return await this.dependencies.shutdownCore(reason)
    } catch (error) {
      this.dependencies.reportError?.('core-shutdown-failed', error)
      return false
    }
  }

  private stopCoreForApplicationExit() {
    if (!this.applicationExitCoreStopPromise) {
      this.applicationExitCoreStopPromise = this.stopCore('frontend_exit')
    }
    return this.applicationExitCoreStopPromise
  }

  private prepareForExitOnce() {
    if (this.preparedForExit) {
      return
    }
    this.preparedForExit = true
    try {
      this.dependencies.prepareForExit()
    } catch (error) {
      this.dependencies.reportError?.('application-exit-prepare-failed', error)
    }
  }

  private closeAllWindowsOnce() {
    if (this.windowsClosed) {
      return
    }
    this.windowsClosed = true
    try {
      this.dependencies.closeAllWindows()
    } catch (error) {
      this.dependencies.reportError?.('application-window-close-failed', error)
    }
  }

  private quitApplicationOnce() {
    if (this.quitRequested) {
      return
    }
    this.quitRequested = true
    try {
      this.dependencies.quitApplication()
    } catch (error) {
      this.dependencies.reportError?.('application-quit-request-failed', error)
    }
  }
}
