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
  closeAllWindows(): void
  quitApplication(): void
  reportError?(event: string, error: unknown): void
}

export class AppExitCoordinator {
  private readonly dependencies: AppExitCoordinatorDependencies
  private appExitPromise: Promise<AppExitResult> | null = null
  private updateInstallPromise: Promise<UpdateInstallResult> | null = null
  private exitRequested = false
  private nativeQuitAllowed = false
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
      this.prepareForExitOnce()
      return true
    }
    event.preventDefault()
    void this.requestApplicationExit('before_quit')
    return false
  }

  canCloseWindow(role: AppWindowRole) {
    return role === 'update' || this.nativeQuitAllowed
  }

  isExitCommitted() {
    return this.nativeQuitAllowed
  }

  isApplicationExiting() {
    return this.exitRequested || this.nativeQuitAllowed
  }

  handleUpdateInstallerFailure(error: unknown) {
    this.dependencies.reportError?.('update-installer-launch-failed', error)
    // Core 已经退出，安装器又未能启动时，继续退出可避免留下无法工作的半关闭应用。
    this.closeAllWindowsOnce()
    this.quitApplicationOnce()
  }

  private async performApplicationExit(source: AppExitSource): Promise<AppExitResult> {
    if (this.updateInstallPromise) {
      const updateResult = await this.updateInstallPromise
      if (updateResult.status === 'ready_to_install') {
        return { mode: 'application_exit', source, coreStopped: true }
      }
    }

    const coreStopped = await this.stopCore('frontend_exit')
    this.nativeQuitAllowed = true
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
