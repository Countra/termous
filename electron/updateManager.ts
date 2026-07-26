import {
  createDefaultUpdatePreferences,
  normalizeUpdatePreferences,
  recordSuccessfulUpdateCheck,
  resolveAutomaticUpdateSchedule,
} from './updatePreferences.ts'
import { normalizeUpdateReleaseNotesText } from './updateReleaseNotes.ts'
import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateErrorCode,
  UpdateManagerOptions,
  UpdatePreferences,
  UpdateProgress,
  UpdateReleaseInfo,
  UpdateSnapshot,
} from './updateTypes.ts'

const releaseNotesLimit = 4_000
const releaseNameLimit = 160
const versionLimit = 64

type UpdateListener = (snapshot: UpdateSnapshot) => void

interface ActiveDownload {
  generation: number
  controller: AbortController
}

interface SafeUpdateError {
  code: UpdateErrorCode
  message: string
  retryable: boolean
}

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

export class UpdateOperationError extends Error {
  readonly code: UpdateErrorCode
  readonly retryable: boolean

  constructor(code: UpdateErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'UpdateOperationError'
    this.code = code
    this.retryable = retryable
  }
}

export class UpdateManager {
  private readonly options: UpdateManagerOptions
  private readonly listeners = new Set<UpdateListener>()
  private snapshot: UpdateSnapshot
  private checkedThisLaunch = false
  private checkPromise: Promise<UpdateSnapshot> | null = null
  private downloadPromise: Promise<UpdateSnapshot> | null = null
  private cancelPromise: Promise<UpdateSnapshot> | null = null
  private installPromise: Promise<UpdateSnapshot> | null = null
  private activeDownload: ActiveDownload | null = null

  constructor(options: UpdateManagerOptions) {
    this.options = options
    const preferences = normalizeUpdatePreferences(
      options.preferences ?? createDefaultUpdatePreferences(),
    )
    const support = options.engine.support
    this.snapshot = {
      state_seq: 0,
      operation_generation: 0,
      phase: support.supported ? 'idle' : 'unsupported',
      current_version: options.engine.currentVersion,
      available_version: null,
      release_name: null,
      release_date: null,
      release_notes: null,
      progress: null,
      checked_at: preferences.last_checked_at,
      error_code: support.supported ? null : 'UPDATE_UNSUPPORTED',
      error_message: null,
      retryable: false,
      support_reason: support.supported ? null : normalizeSupportReason(support.reason),
      preferences: { ...preferences },
      next_automatic_check_at: this.resolveNextAutomaticCheckAt(preferences),
    }
  }

  getSnapshot(): UpdateSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  subscribe(listener: UpdateListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setPreferences(preferences: UpdatePreferences) {
    const normalized = normalizeUpdatePreferences(preferences)
    this.transition({
      preferences: normalized,
      checked_at: normalized.last_checked_at,
      next_automatic_check_at: this.resolveNextAutomaticCheckAt(normalized),
    })
    return this.getSnapshot()
  }

  check(source: 'manual' | 'automatic' = 'manual'): Promise<UpdateSnapshot> {
    if (this.checkPromise) {
      return this.checkPromise
    }
    if (!this.options.engine.support.supported || isExclusivePhase(this.snapshot.phase)) {
      return Promise.resolve(this.getSnapshot())
    }

    const generation = this.nextGeneration()
    this.transition({
      phase: 'checking',
      operation_generation: generation,
      error_code: null,
      error_message: null,
      retryable: false,
    })
    this.options.logger?.info('update_check_started', { generation, source })

    const operation = this.performCheck(generation, source).finally(() => {
      if (this.checkPromise === operation) {
        this.checkPromise = null
      }
    })
    this.checkPromise = operation
    return operation
  }

  download(): Promise<UpdateSnapshot> {
    if (this.downloadPromise) {
      return this.downloadPromise
    }
    if (
      !this.options.engine.support.supported
      || !this.snapshot.available_version
      || !canStartDownload(this.snapshot)
    ) {
      return Promise.resolve(this.getSnapshot())
    }

    const generation = this.nextGeneration()
    const activeDownload: ActiveDownload = {
      generation,
      controller: new AbortController(),
    }
    this.activeDownload = activeDownload
    this.transition({
      phase: 'downloading',
      operation_generation: generation,
      progress: {
        percent: 0,
        transferred: 0,
        total: 0,
        bytes_per_second: 0,
      },
      error_code: null,
      error_message: null,
      retryable: false,
    })
    this.options.logger?.info('update_download_started', {
      generation,
      version: this.snapshot.available_version,
    })

    const operation = this.performDownload(activeDownload).finally(() => {
      if (this.downloadPromise === operation) {
        this.downloadPromise = null
      }
      if (this.activeDownload === activeDownload) {
        this.activeDownload = null
      }
    })
    this.downloadPromise = operation
    return operation
  }

  cancelDownload(): Promise<UpdateSnapshot> {
    if (this.cancelPromise) {
      return this.cancelPromise
    }
    const activeDownload = this.activeDownload
    if (!activeDownload || this.snapshot.phase !== 'downloading') {
      return Promise.resolve(this.getSnapshot())
    }

    activeDownload.controller.abort()
    const operation = this.performCancel(activeDownload).finally(() => {
      if (this.cancelPromise === operation) {
        this.cancelPromise = null
      }
    })
    this.cancelPromise = operation
    return operation
  }

  install(): Promise<UpdateSnapshot> {
    if (this.installPromise) {
      return this.installPromise
    }
    if (!canStartInstall(this.snapshot)) {
      return Promise.resolve(this.getSnapshot())
    }

    const generation = this.nextGeneration()
    this.transition({
      phase: 'preparing_install',
      operation_generation: generation,
      error_code: null,
      error_message: null,
      retryable: false,
    })
    this.options.logger?.info('update_install_preparing', {
      generation,
      version: this.snapshot.available_version,
    })

    const operation = this.performInstall(generation).finally(() => {
      if (this.installPromise === operation) {
        this.installPromise = null
      }
    })
    this.installPromise = operation
    return operation
  }

  private async performCheck(
    generation: number,
    source: 'manual' | 'automatic',
  ): Promise<UpdateSnapshot> {
    try {
      const result = await this.options.engine.checkForUpdates()
      if (!this.isCurrentOperation(generation, 'checking')) {
        return this.getSnapshot()
      }
      const release = result.update_available ? normalizeRelease(result) : null
      const checkedAt = new Date(this.now()).toISOString()
      this.checkedThisLaunch = true
      const preferences = await this.persistPreferences(
        recordSuccessfulUpdateCheck(this.snapshot.preferences, checkedAt),
      )

      if (release) {
        this.transition({
          ...releaseSnapshotFields(release),
          phase: 'available',
          checked_at: checkedAt,
          preferences,
          next_automatic_check_at: this.resolveNextAutomaticCheckAt(preferences),
          progress: null,
          error_code: null,
          error_message: null,
          retryable: false,
        })
        this.options.logger?.info('update_available', {
          generation,
          version: release.version,
          source,
        })
        if (source === 'automatic' && preferences.automatic_download) {
          return this.download()
        }
      } else {
        this.transition({
          phase: 'up_to_date',
          checked_at: checkedAt,
          preferences,
          next_automatic_check_at: this.resolveNextAutomaticCheckAt(preferences),
          available_version: null,
          release_name: null,
          release_date: null,
          release_notes: null,
          progress: null,
          error_code: null,
          error_message: null,
          retryable: false,
        })
        this.options.logger?.info('update_up_to_date', { generation, source })
      }
    } catch (error) {
      if (this.isCurrentOperation(generation, 'checking')) {
        this.fail(
          toSafeUpdateError(error, 'UPDATE_CHECK_FAILED', '检查更新失败，请稍后重试', true),
          generation,
        )
      }
    }
    return this.getSnapshot()
  }

  private async performDownload(activeDownload: ActiveDownload): Promise<UpdateSnapshot> {
    const { generation, controller } = activeDownload
    try {
      await this.options.engine.downloadUpdate({
        generation,
        signal: controller.signal,
        onProgress: (progress) => {
          this.applyDownloadProgress(generation, progress)
        },
      })
      if (
        !controller.signal.aborted
        && this.isCurrentOperation(generation, 'downloading')
      ) {
        const progress = finishProgress(this.snapshot.progress)
        this.transition({
          phase: 'downloaded',
          progress,
          error_code: null,
          error_message: null,
          retryable: false,
        })
        this.options.logger?.info('update_downloaded', {
          generation,
          version: this.snapshot.available_version,
        })
      }
    } catch (error) {
      if (
        !controller.signal.aborted
        && this.isCurrentOperation(generation, 'downloading')
      ) {
        this.fail(
          toSafeUpdateError(error, 'UPDATE_DOWNLOAD_FAILED', '更新下载失败，请稍后重试', true),
          generation,
        )
      }
    }
    return this.getSnapshot()
  }

  private async performCancel(activeDownload: ActiveDownload): Promise<UpdateSnapshot> {
    try {
      await this.options.engine.cancelDownload(activeDownload.generation)
      if (this.snapshot.operation_generation === activeDownload.generation) {
        this.transition({
          phase: 'available',
          progress: null,
          error_code: null,
          error_message: null,
          retryable: false,
        })
      }
      if (this.activeDownload === activeDownload) {
        this.activeDownload = null
      }
      this.downloadPromise = null
      this.options.logger?.info('update_download_canceled', {
        generation: activeDownload.generation,
      })
    } catch (error) {
      if (this.snapshot.operation_generation === activeDownload.generation) {
        this.fail(
          toSafeUpdateError(error, 'UPDATE_CANCEL_FAILED', '无法取消更新下载', true),
          activeDownload.generation,
        )
      }
    }
    return this.getSnapshot()
  }

  private async performInstall(generation: number): Promise<UpdateSnapshot> {
    let installStarted = false
    let installRecovered = false
    try {
      await this.options.installLifecycle.prepareForInstall()
      if (!this.isCurrentOperation(generation, 'preparing_install')) {
        return this.getSnapshot()
      }
      this.transition({
        phase: 'installing',
        error_code: null,
        error_message: null,
        retryable: false,
      })
      installStarted = true
      await this.options.engine.installUpdate()
      this.options.logger?.info('update_install_started', {
        generation,
        version: this.snapshot.available_version,
      })
    } catch (error) {
      if (this.snapshot.operation_generation !== generation) {
        return this.getSnapshot()
      }
      if (installStarted) {
        installRecovered = await this.recoverInstallFailure()
      }
      const fallback = installStarted
        ? {
            code: 'UPDATE_INSTALL_START_FAILED' as const,
            message: '无法启动更新安装程序',
          }
        : {
            code: 'UPDATE_CORE_SHUTDOWN_FAILED' as const,
            message: '核心服务未能安全退出，更新尚未安装',
          }
      const safeError = toSafeUpdateError(
        error,
        fallback.code,
        fallback.message,
        !installStarted || installRecovered,
      )
      this.fail(
        installStarted && !installRecovered
          ? { ...safeError, retryable: false }
          : safeError,
        generation,
      )
    }
    return this.getSnapshot()
  }

  private applyDownloadProgress(generation: number, raw: UpdateDownloadProgress) {
    if (!this.isCurrentOperation(generation, 'downloading')) {
      return
    }
    const progress = normalizeProgress(this.snapshot.progress, raw)
    if (sameProgress(this.snapshot.progress, progress)) {
      return
    }
    this.transition({ progress })
  }

  private fail(error: SafeUpdateError, generation: number) {
    this.transition({
      phase: 'error',
      operation_generation: generation,
      error_code: error.code,
      error_message: error.message,
      retryable: error.retryable,
    })
    this.options.logger?.error('update_operation_failed', {
      generation,
      code: error.code,
    })
  }

  private async persistPreferences(preferences: UpdatePreferences) {
    if (!this.options.persistPreferences) {
      return preferences
    }
    try {
      return await this.options.persistPreferences({ ...preferences }) ?? preferences
    } catch {
      this.options.logger?.error('update_preferences_persist_failed')
      return {
        ...this.snapshot.preferences,
        last_checked_at: preferences.last_checked_at,
        revision: this.snapshot.preferences.revision,
      }
    }
  }

  private async recoverInstallFailure() {
    if (!this.options.installLifecycle.recoverFromInstallFailure) {
      return false
    }
    try {
      return await this.options.installLifecycle.recoverFromInstallFailure()
    } catch {
      this.options.logger?.error('update_install_recovery_failed')
      return false
    }
  }

  private transition(patch: Partial<UpdateSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      state_seq: this.snapshot.state_seq + 1,
      preferences: patch.preferences
        ? { ...patch.preferences }
        : { ...this.snapshot.preferences },
      progress: patch.progress === undefined
        ? cloneProgress(this.snapshot.progress)
        : cloneProgress(patch.progress),
    }
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      try {
        listener(cloneSnapshot(snapshot))
      } catch {
        this.options.logger?.error('update_state_listener_failed')
      }
    }
  }

  private nextGeneration() {
    return this.snapshot.operation_generation + 1
  }

  private isCurrentOperation(generation: number, phase: UpdateSnapshot['phase']) {
    return (
      this.snapshot.operation_generation === generation
      && this.snapshot.phase === phase
    )
  }

  private resolveNextAutomaticCheckAt(preferences: UpdatePreferences) {
    return resolveAutomaticUpdateSchedule(preferences, {
      now: this.now(),
      checked_this_launch: this.checkedThisLaunch,
    }).next_check_at
  }

  private now() {
    const value = this.options.now?.() ?? Date.now()
    return Number.isFinite(value) && value >= 0 ? value : 0
  }
}

function normalizeRelease(result: UpdateCheckResult): UpdateReleaseInfo {
  const release = result.release
  if (!release || !isValidVersion(release.version)) {
    throw new UpdateOperationError(
      'UPDATE_METADATA_INVALID',
      '更新元数据无效',
      true,
    )
  }
  return {
    version: release.version.trim(),
    release_name: sanitizeText(release.release_name, releaseNameLimit),
    release_date: normalizeDate(release.release_date),
    release_notes: normalizeUpdateReleaseNotesText(
      release.release_notes,
      releaseNotesLimit,
    ),
  }
}

function releaseSnapshotFields(release: UpdateReleaseInfo) {
  return {
    available_version: release.version,
    release_name: release.release_name ?? null,
    release_date: release.release_date ?? null,
    release_notes: release.release_notes ?? null,
  }
}

function normalizeProgress(
  previous: UpdateProgress | null,
  raw: UpdateDownloadProgress,
): UpdateProgress {
  const prior = previous ?? {
    percent: 0,
    transferred: 0,
    total: 0,
    bytes_per_second: 0,
  }
  const incomingTransferred = finiteNonNegative(raw.transferred)
  const incomingTotal = Math.max(finiteNonNegative(raw.total), incomingTransferred)
  const incomingPercent = incomingTotal > 0
    ? clampPercent((incomingTransferred / incomingTotal) * 100)
    : clampPercent(raw.percent)
  const streamRestarted = (
    prior.total > 0
    && incomingTotal > 0
    && (
      incomingTotal > prior.total
      || (
        incomingTransferred < prior.transferred
        && prior.percent >= 99
        && incomingPercent < prior.percent
      )
    )
  )
  const transferred = streamRestarted
    ? incomingTransferred
    : Math.max(prior.transferred, incomingTransferred)
  const total = streamRestarted
    ? incomingTotal
    : Math.max(prior.total, incomingTotal, transferred)
  const percent = total > 0
    ? Math.min(99, clampPercent((transferred / total) * 100))
    : Math.min(99, Math.max(clampPercent(prior.percent), incomingPercent))
  return {
    percent,
    transferred,
    total,
    bytes_per_second: finiteNonNegative(raw.bytes_per_second),
  }
}

function finishProgress(progress: UpdateProgress | null): UpdateProgress {
  const current = progress ?? {
    percent: 0,
    transferred: 0,
    total: 0,
    bytes_per_second: 0,
  }
  return {
    ...current,
    percent: 100,
    transferred: current.total > 0 ? current.total : current.transferred,
    bytes_per_second: 0,
  }
}

function sameProgress(left: UpdateProgress | null, right: UpdateProgress) {
  return Boolean(
    left
    && left.percent === right.percent
    && left.transferred === right.transferred
    && left.total === right.total
    && left.bytes_per_second === right.bytes_per_second,
  )
}

function canStartDownload(snapshot: UpdateSnapshot) {
  return (
    snapshot.phase === 'available'
    || (
      snapshot.phase === 'error'
      && snapshot.retryable
      && snapshot.error_code !== 'UPDATE_CORE_SHUTDOWN_FAILED'
      && snapshot.error_code !== 'UPDATE_INSTALL_SUMMARY_STALE'
      && snapshot.error_code !== 'UPDATE_INSTALL_START_FAILED'
    )
  )
}

function canStartInstall(snapshot: UpdateSnapshot) {
  return (
    snapshot.phase === 'downloaded'
    || (
      snapshot.phase === 'error'
      && snapshot.retryable
      && (
        snapshot.error_code === 'UPDATE_CORE_SHUTDOWN_FAILED'
        || snapshot.error_code === 'UPDATE_INSTALL_SUMMARY_STALE'
        || snapshot.error_code === 'UPDATE_INSTALL_START_FAILED'
      )
    )
  )
}

function isExclusivePhase(phase: UpdateSnapshot['phase']) {
  return (
    phase === 'downloading'
    || phase === 'downloaded'
    || phase === 'preparing_install'
    || phase === 'installing'
  )
}

function toSafeUpdateError(
  error: unknown,
  fallbackCode: UpdateErrorCode,
  fallbackMessage: string,
  fallbackRetryable: boolean,
): SafeUpdateError {
  if (error instanceof UpdateOperationError) {
    return {
      code: error.code,
      message: safeErrorMessages[error.code] ?? fallbackMessage,
      retryable: error.retryable,
    }
  }
  return {
    code: fallbackCode,
    message: fallbackMessage,
    retryable: fallbackRetryable,
  }
}

function normalizeSupportReason(value: unknown) {
  return sanitizeText(value, 160) ?? 'unsupported_runtime'
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function sanitizeText(value: unknown, limit: number) {
  if (typeof value !== 'string') {
    return null
  }
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) {
    return null
  }
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function isValidVersion(value: unknown) {
  return (
    typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= versionLimit
    && /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(value.trim())
  )
}

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function clampPercent(value: unknown) {
  return Math.min(100, finiteNonNegative(value))
}

function cloneProgress(progress: UpdateProgress | null) {
  return progress ? { ...progress } : null
}

function cloneSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    progress: cloneProgress(snapshot.progress),
    preferences: { ...snapshot.preferences },
  }
}

export type {
  InstallLifecycle,
  UpdateApplicationInfo,
  UpdateCheckResult,
  UpdateDownloadContext,
  UpdateDownloadProgress,
  UpdateEngine,
  UpdateErrorCode,
  UpdateManagerLogger,
  UpdateManagerOptions,
  UpdatePhase,
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateProgress,
  UpdateReleaseInfo,
  UpdateSnapshot,
  UpdateSupport,
} from './updateTypes.ts'
