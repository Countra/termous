import { CancellationError, CancellationToken } from 'builder-util-runtime'
import electronModule from 'electron'
import electronUpdaterModule from 'electron-updater'
import { accessSync, constants as fsConstants, lstatSync } from 'node:fs'
import { posix as pathPosix } from 'node:path'
import { UpdateOperationError } from './updateManager.ts'
import {
  closeUnterminatedUpdateReleaseNotesFence,
  normalizeUpdateReleaseNotesText,
  truncateUpdateReleaseNotesRawInput,
  updateReleaseNotesRawInputLimit,
} from './updateReleaseNotes.ts'
import type {
  UpdateCheckResult,
  UpdateEngine,
  UpdateErrorCode,
  UpdateReleaseInfo,
  UpdateSupport,
} from '#common/contracts'

const releaseNotesLimit = 4_000
const releaseNotesEntryLimit = 16
const releaseNotesEntryRawInputLimit = 8_000
const versionLimit = 64
const installLaunchTimeoutMs = 120_000

const safeErrorMessages: Record<UpdateErrorCode, string> = {
  UPDATE_UNSUPPORTED: '当前安装环境不支持应用内更新',
  UPDATE_CHECK_FAILED: '检查更新失败，请稍后重试',
  UPDATE_METADATA_INVALID: '更新元数据无效',
  UPDATE_ASSET_NOT_FOUND: '没有找到适用于当前系统的更新包',
  UPDATE_DOWNLOAD_FAILED: '更新下载失败，请稍后重试',
  UPDATE_DOWNLOAD_CANCELED: '更新下载已取消',
  UPDATE_CANCEL_FAILED: '无法取消更新下载',
  UPDATE_HASH_MISMATCH: '更新包完整性校验失败',
  UPDATE_SIGNATURE_INVALID: '更新包签名校验失败',
  UPDATE_CORE_SHUTDOWN_FAILED: '核心服务未能安全退出，更新尚未安装',
  UPDATE_INSTALL_SUMMARY_STALE: '运行状态已变化，请重新确认后安装',
  UPDATE_INSTALL_START_FAILED: '无法启动更新安装程序',
}

const metadataErrorCodes = new Set([
  'ERR_UPDATER_INVALID_CHANNEL',
  'ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION',
  'ERR_UPDATER_INVALID_RELEASE_FEED',
  'ERR_UPDATER_INVALID_UPDATE_INFO',
  'ERR_UPDATER_INVALID_VERSION',
  'ERR_UPDATER_NO_CHECKSUM',
  'ERR_UPDATER_UNSUPPORTED_PROVIDER',
])

const assetErrorCodes = new Set([
  'ERR_UPDATER_ASSET_NOT_FOUND',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_NO_FILES_PROVIDED',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_RELEASE_NOT_FOUND',
  'ERR_UPDATER_WEB_INSTALLER_DISABLED',
  'ERR_UPDATER_ZIP_FILE_NOT_FOUND',
])

export interface ElectronUpdaterProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface ElectronUpdaterReleaseNote {
  version: string
  note: string | null
}

export interface ElectronUpdaterUpdateInfo {
  version: string
  releaseName?: string | null
  releaseDate?: string | null
  releaseNotes?: string | ElectronUpdaterReleaseNote[] | null
}

export interface ElectronUpdaterCheckResult {
  isUpdateAvailable: boolean
  updateInfo: ElectronUpdaterUpdateInfo
}

export interface ElectronUpdaterAdapter {
  logger: {
    info: (message?: unknown) => void
    warn: (message?: unknown) => void
    error: (message?: unknown) => void
  } | null
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  disableDifferentialDownload: boolean
  checkForUpdates: () => Promise<ElectronUpdaterCheckResult | null>
  downloadUpdate: (cancellationToken?: CancellationToken) => Promise<readonly string[]>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  on: {
    (
      event: 'download-progress',
      listener: (progress: ElectronUpdaterProgress) => void,
    ): unknown
    (
      event: 'error',
      listener: (error: Error, message?: string) => void,
    ): unknown
  }
  removeListener: {
    (
      event: 'download-progress',
      listener: (progress: ElectronUpdaterProgress) => void,
    ): unknown
    (
      event: 'error',
      listener: (error: Error, message?: string) => void,
    ): unknown
  }
}

export interface ElectronUpdaterApp {
  readonly isPackaged: boolean
  getVersion: () => string
}

export interface ElectronInstallEventSource {
  once: (
    event: 'before-quit-for-update',
    listener: () => void,
  ) => unknown
  removeListener: (
    event: 'before-quit-for-update',
    listener: () => void,
  ) => unknown
}

export interface AppImageFileSystem {
  isRegularFile: (filePath: string) => boolean
  isWritable: (filePath: string) => boolean
}

export interface ElectronUpdaterEngineOptions {
  updater?: ElectronUpdaterAdapter
  app?: ElectronUpdaterApp
  installEventSource?: ElectronInstallEventSource
  platform?: NodeJS.Platform
  env?: Readonly<Record<string, string | undefined>>
  isMacAppStore?: boolean
  isWindowsStore?: boolean
  appImageFileSystem?: AppImageFileSystem
  installLaunchTimeoutMs?: number
  launchInstall?: (updater: ElectronUpdaterAdapter) => void
  onDownloadedFiles?: (paths: readonly string[]) => void
}

interface ActiveDownload {
  requestCancellation: () => void
  detachListeners: () => void
  settled: Promise<void>
}

type UpdaterOperation = 'check' | 'download' | 'cancel' | 'install'
type InstallLaunchTimeoutDisposition = 'recoverable_failure' | 'handoff_committed'

export function createElectronUpdaterEngine(
  options: ElectronUpdaterEngineOptions = {},
): UpdateEngine {
  const updater = options.updater ?? getDefaultUpdater()
  const app = options.app ?? getDefaultApp()
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const processFlags = process as NodeJS.Process & {
    mas?: boolean
    windowsStore?: boolean
  }
  const support = Object.freeze(resolveUpdateSupport({
    isPackaged: app.isPackaged,
    platform,
    env,
    isMacAppStore: options.isMacAppStore ?? processFlags.mas === true,
    isWindowsStore: options.isWindowsStore ?? processFlags.windowsStore === true,
    appImageFileSystem: options.appImageFileSystem ?? defaultAppImageFileSystem,
  }))
  const currentVersion = readCurrentVersion(app)
  const launchInstall = options.launchInstall ?? defaultLaunchInstall
  const installEventSource = options.installEventSource
    ?? getDefaultInstallEventSource()
  const activeDownloads = new Map<number, ActiveDownload>()

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = isPrereleaseVersion(currentVersion)
  updater.allowDowngrade = false
  updater.disableWebInstaller = true
  updater.disableDifferentialDownload = true
  updater.logger = null

  return {
    currentVersion,
    support,
    checkForUpdates: async () => {
      assertSupported(support)
      try {
        const result = await updater.checkForUpdates()
        if (!result) {
          throw unsupportedError()
        }
        return normalizeCheckResult(result)
      } catch (error) {
        throw classifyUpdaterError(error, 'check')
      }
    },
    downloadUpdate: async (context) => {
      assertSupported(support)
      const token = new CancellationToken()
      let resolveSettled!: () => void
      const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve
      })
      let listenersDetached = false
      let progressAttached = false
      let cancellationRequested = false
      const progressListener = (progress: ElectronUpdaterProgress) => {
        if (cancellationRequested || context.signal.aborted) {
          return
        }
        context.onProgress({
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytes_per_second: progress.bytesPerSecond,
        })
      }
      const requestCancellation = () => {
        if (cancellationRequested) {
          return
        }
        cancellationRequested = true
        token.cancel()
      }
      const detachListeners = () => {
        if (listenersDetached) {
          return
        }
        listenersDetached = true
        context.signal.removeEventListener('abort', requestCancellation)
        if (progressAttached) {
          updater.removeListener('download-progress', progressListener)
        }
      }
      const activeDownload: ActiveDownload = {
        requestCancellation,
        detachListeners,
        settled,
      }
      activeDownloads.set(context.generation, activeDownload)

      let failure: UpdateOperationError | null = null
      try {
        context.signal.addEventListener('abort', requestCancellation, { once: true })
        updater.on('download-progress', progressListener)
        progressAttached = true
        if (context.signal.aborted) {
          requestCancellation()
          throw new CancellationError()
        }
        const downloadedFiles = await updater.downloadUpdate(token)
        if (cancellationRequested || context.signal.aborted || token.cancelled) {
          throw new CancellationError()
        }
        options.onDownloadedFiles?.([...downloadedFiles])
      } catch (error) {
        failure = classifyUpdaterError(
          error,
          'download',
          cancellationRequested || context.signal.aborted || token.cancelled,
        )
      }

      try {
        detachListeners()
      } catch (error) {
        failure ??= classifyUpdaterError(error, 'download')
      } finally {
        try {
          token.dispose()
        } catch (error) {
          failure ??= classifyUpdaterError(error, 'download')
        } finally {
          if (activeDownloads.get(context.generation) === activeDownload) {
            activeDownloads.delete(context.generation)
          }
          resolveSettled()
        }
      }

      if (failure) {
        throw failure
      }
    },
    cancelDownload: async (generation) => {
      assertSupported(support)
      const activeDownload = activeDownloads.get(generation)
      if (!activeDownload) {
        return
      }
      let failure: UpdateOperationError | null = null
      try {
        activeDownload.requestCancellation()
      } catch (error) {
        failure = classifyUpdaterError(error, 'cancel')
      }
      try {
        activeDownload.detachListeners()
      } catch (error) {
        failure ??= classifyUpdaterError(error, 'cancel')
      }
      await activeDownload.settled
      if (failure) {
        throw failure
      }
    },
    installUpdate: async () => {
      assertSupported(support)
      let failure: UpdateOperationError | null = null
      let rejectUpdaterError!: (error: Error) => void
      const updaterError = new Promise<never>((_resolve, reject) => {
        rejectUpdaterError = reject
      })
      const errorListener = (error: Error) => {
        rejectUpdaterError(error)
      }
      let errorListenerAttached = false
      let launchObservation: ReturnType<typeof observeInstallLaunch> | null = null

      try {
        launchObservation = observeInstallLaunch(
          installEventSource,
          options.installLaunchTimeoutMs ?? installLaunchTimeoutMs,
          platform === 'darwin'
            ? 'handoff_committed'
            : 'recoverable_failure',
        )
        updater.on('error', errorListener)
        errorListenerAttached = true
        launchInstall(updater)
        await Promise.race([
          launchObservation.settled,
          updaterError,
        ])
      } catch (error) {
        failure = classifyUpdaterError(error, 'install')
      }

      try {
        launchObservation?.dispose()
      } catch (error) {
        failure ??= classifyUpdaterError(error, 'install')
      }
      if (errorListenerAttached) {
        try {
          updater.removeListener('error', errorListener)
        } catch (error) {
          failure ??= classifyUpdaterError(error, 'install')
        }
      }

      if (failure) {
        throw failure
      }
    },
  }
}

function defaultLaunchInstall(updater: ElectronUpdaterAdapter) {
  updater.quitAndInstall(false, true)
}

function observeInstallLaunch(
  eventSource: ElectronInstallEventSource | null,
  timeoutMilliseconds: number,
  timeoutDisposition: InstallLaunchTimeoutDisposition,
) {
  let settled = false
  let firstImmediate: NodeJS.Immediate | null = null
  let secondImmediate: NodeJS.Immediate | null = null
  let timeout: NodeJS.Timeout | null = null
  let attachedEventSource: ElectronInstallEventSource | null = null
  let resolveSettled!: () => void
  let rejectSettled!: (error: Error) => void
  const settledPromise = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve
    rejectSettled = reject
  })
  const finish = (error?: Error) => {
    if (settled) {
      return
    }
    settled = true
    if (error) {
      rejectSettled(error)
      return
    }
    resolveSettled()
  }
  const installQuitListener = () => {
    finish()
  }

  if (eventSource) {
    eventSource.once('before-quit-for-update', installQuitListener)
    attachedEventSource = eventSource
    timeout = setTimeout(() => {
      if (timeoutDisposition === 'handoff_committed') {
        // macOS 的 Squirrel 可能在 quitAndInstall 返回很久后才收到原生下载完成事件。
        // 此时交接已经不可撤销，继续按失败恢复会让迟到事件退出已恢复的应用。
        finish()
        return
      }
      finish(new Error('update_installer_launch_timeout'))
    }, normalizeInstallLaunchTimeout(timeoutMilliseconds))
  } else {
    // 测试适配器没有 Electron app 事件时，至少跨过两个事件循环检查异步启动错误。
    firstImmediate = setImmediate(() => {
      firstImmediate = null
      secondImmediate = setImmediate(() => {
        secondImmediate = null
        finish()
      })
    })
  }

  return {
    settled: settledPromise,
    dispose: () => {
      settled = true
      if (attachedEventSource) {
        attachedEventSource.removeListener(
          'before-quit-for-update',
          installQuitListener,
        )
        attachedEventSource = null
      }
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (firstImmediate) {
        clearImmediate(firstImmediate)
        firstImmediate = null
      }
      if (secondImmediate) {
        clearImmediate(secondImmediate)
        secondImmediate = null
      }
    },
  }
}

function normalizeInstallLaunchTimeout(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return installLaunchTimeoutMs
  }
  return Math.max(1, Math.floor(value))
}

function getDefaultUpdater(): ElectronUpdaterAdapter {
  const updater = (
    electronUpdaterModule as unknown as {
      autoUpdater?: ElectronUpdaterAdapter
    }
  ).autoUpdater
  if (!updater) {
    throw new Error('electron-updater autoUpdater 不可用')
  }
  return updater
}

function getDefaultApp(): ElectronUpdaterApp {
  const app = (
    electronModule as unknown as {
      app?: ElectronUpdaterApp
    }
  ).app
  if (!app) {
    throw new Error('Electron app 不可用')
  }
  return app
}

function getDefaultInstallEventSource(): ElectronInstallEventSource | null {
  return (
    electronModule as unknown as {
      autoUpdater?: ElectronInstallEventSource
    }
  ).autoUpdater ?? null
}

function readCurrentVersion(app: ElectronUpdaterApp) {
  const version = app.getVersion()
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('无法读取当前应用版本')
  }
  return version.trim()
}

function isPrereleaseVersion(version: string) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z.-]+)?$/.test(
    version.trim(),
  )
}

function resolveUpdateSupport(input: {
  isPackaged: boolean
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  isMacAppStore: boolean
  isWindowsStore: boolean
  appImageFileSystem: AppImageFileSystem
}): UpdateSupport {
  if (!input.isPackaged) {
    return { supported: false, reason: 'not_packaged' }
  }
  if (input.platform === 'win32') {
    return input.isWindowsStore
      ? { supported: false, reason: 'unsupported_windows_store' }
      : { supported: true }
  }
  if (input.platform === 'darwin') {
    return input.isMacAppStore
      ? { supported: false, reason: 'unsupported_mac_app_store' }
      : { supported: true }
  }
  if (input.platform === 'linux') {
    const appImagePath = input.env.APPIMAGE
    if (!isValidAppImagePath(appImagePath)) {
      return { supported: false, reason: 'unsupported_linux_package' }
    }
    return canReplaceAppImage(input.appImageFileSystem, appImagePath)
      ? { supported: true }
      : { supported: false, reason: 'appimage_not_writable' }
  }
  return { supported: false, reason: 'unsupported_platform' }
}

function isValidAppImagePath(value: string | undefined): value is string {
  return Boolean(
    value
    && pathPosix.isAbsolute(value)
    && !value.includes('\0'),
  )
}

const defaultAppImageFileSystem: AppImageFileSystem = {
  isRegularFile: (filePath) => lstatSync(filePath).isFile(),
  isWritable: (filePath) => {
    accessSync(filePath, fsConstants.W_OK)
    return true
  },
}

function canReplaceAppImage(
  fileSystem: AppImageFileSystem,
  filePath: string,
) {
  try {
    return fileSystem.isRegularFile(filePath) === true
      && fileSystem.isWritable(filePath) === true
      && fileSystem.isWritable(pathPosix.dirname(filePath)) === true
  } catch {
    return false
  }
}

function assertSupported(support: UpdateSupport) {
  if (!support.supported) {
    throw unsupportedError()
  }
}

function unsupportedError() {
  return new UpdateOperationError(
    'UPDATE_UNSUPPORTED',
    safeErrorMessages.UPDATE_UNSUPPORTED,
    false,
  )
}

function normalizeCheckResult(
  result: ElectronUpdaterCheckResult,
): UpdateCheckResult {
  if (!result.isUpdateAvailable) {
    return { update_available: false }
  }
  const release = normalizeRelease(result.updateInfo)
  return {
    update_available: true,
    release,
  }
}

function normalizeRelease(
  updateInfo: ElectronUpdaterUpdateInfo,
): UpdateReleaseInfo {
  if (
    !updateInfo
    || typeof updateInfo.version !== 'string'
    || !isValidVersion(updateInfo.version)
  ) {
    throw new UpdateOperationError(
      'UPDATE_METADATA_INVALID',
      safeErrorMessages.UPDATE_METADATA_INVALID,
      true,
    )
  }
  const version = updateInfo.version.trim()
  return {
    version,
    release_name: normalizeOptionalText(updateInfo.releaseName),
    release_date: normalizeOptionalText(updateInfo.releaseDate),
    release_notes: normalizeReleaseNotes(updateInfo.releaseNotes),
  }
}

function normalizeReleaseNotes(
  value: ElectronUpdaterUpdateInfo['releaseNotes'],
) {
  if (!Array.isArray(value)) {
    return normalizeUpdateReleaseNotesText(value, releaseNotesLimit)
  }
  const notes = collectReleaseNotes(value)
  return normalizeUpdateReleaseNotesText(notes, releaseNotesLimit)
}

function collectReleaseNotes(value: ElectronUpdaterReleaseNote[]) {
  let notes = ''
  let rawInputRemaining = updateReleaseNotesRawInputLimit
  for (const entry of value.slice(0, releaseNotesEntryLimit)) {
    if (typeof entry?.note !== 'string') {
      continue
    }
    const rawInput = truncateUpdateReleaseNotesRawInput(
      entry.note,
      Math.min(releaseNotesEntryRawInputLimit, rawInputRemaining),
    )
    rawInputRemaining -= rawInput.length
    const normalized = normalizeUpdateReleaseNotesText(
      rawInput,
      releaseNotesLimit,
    )
    if (!normalized) {
      if (rawInputRemaining <= 0) {
        break
      }
      continue
    }
    const isolated = closeUnterminatedUpdateReleaseNotesFence(
      normalized,
      releaseNotesLimit,
    )
    const separator = notes ? '\n\n' : ''
    const remaining = updateReleaseNotesRawInputLimit
      - notes.length
      - separator.length
    if (remaining <= 0) {
      break
    }
    const note = truncateUpdateReleaseNotesRawInput(isolated, remaining)
    if (!note) {
      break
    }
    notes += `${separator}${note}`
    if (Array.from(notes).length >= releaseNotesLimit) {
      break
    }
    if (rawInputRemaining <= 0) {
      break
    }
  }
  return notes
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized || null
}

function isValidVersion(value: string) {
  const version = value.trim()
  return (
    version.length > 0
    && version.length <= versionLimit
    && /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)
  )
}

function classifyUpdaterError(
  error: unknown,
  operation: UpdaterOperation,
  cancellationRequested = false,
): UpdateOperationError {
  if (error instanceof UpdateOperationError) {
    return error
  }
  if (cancellationRequested || isCancellationError(error)) {
    return operationError('UPDATE_DOWNLOAD_CANCELED', true)
  }

  const code = readErrorCode(error)
  const message = readErrorMessage(error).toLowerCase()
  if (
    code === 'ERR_UPDATER_INVALID_SIGNATURE'
    || message.includes('not signed by the application owner')
    || message.includes('signature verification failed')
  ) {
    return operationError('UPDATE_SIGNATURE_INVALID', false)
  }
  if (
    code === 'ERR_CHECKSUM_MISMATCH'
    || message.includes('checksum mismatch')
  ) {
    return operationError('UPDATE_HASH_MISMATCH', true)
  }
  if (
    assetErrorCodes.has(code)
    || code === 'HTTP_ERROR_404'
    || readHttpStatus(error) === 404
  ) {
    return operationError('UPDATE_ASSET_NOT_FOUND', true)
  }
  if (metadataErrorCodes.has(code)) {
    return operationError('UPDATE_METADATA_INVALID', true)
  }

  if (operation === 'download') {
    return operationError('UPDATE_DOWNLOAD_FAILED', true)
  }
  if (operation === 'cancel') {
    return operationError('UPDATE_CANCEL_FAILED', true)
  }
  if (operation === 'install') {
    return operationError('UPDATE_INSTALL_START_FAILED', true)
  }
  return operationError('UPDATE_CHECK_FAILED', true)
}

function operationError(code: UpdateErrorCode, retryable: boolean) {
  return new UpdateOperationError(code, safeErrorMessages[code], retryable)
}

function isCancellationError(error: unknown) {
  if (error instanceof CancellationError) {
    return true
  }
  const name = readErrorField(error, 'name')
  const message = readErrorMessage(error).trim().toLowerCase()
  return (
    name === 'CancellationError'
    || message === 'cancelled'
    || message === 'canceled'
  )
}

function readErrorCode(error: unknown) {
  const code = readErrorField(error, 'code')
  return typeof code === 'string' ? code : ''
}

function readErrorMessage(error: unknown) {
  const message = readErrorField(error, 'message')
  return typeof message === 'string' ? message : ''
}

function readHttpStatus(error: unknown) {
  const status = readErrorField(error, 'statusCode')
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function readErrorField(error: unknown, field: string): unknown {
  if (
    typeof error !== 'object'
    || error === null
    || !(field in error)
  ) {
    return undefined
  }
  return (error as Record<string, unknown>)[field]
}
