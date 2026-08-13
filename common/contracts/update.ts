import type { AppLanguage, AppTheme } from './application'

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'preparing_install'
  | 'installing'
  | 'error'

export type UpdateCheckInterval = 'startup' | 'daily' | 'weekly'

export type UpdateErrorCode =
  | 'UPDATE_UNSUPPORTED'
  | 'UPDATE_CHECK_FAILED'
  | 'UPDATE_METADATA_INVALID'
  | 'UPDATE_ASSET_NOT_FOUND'
  | 'UPDATE_DOWNLOAD_FAILED'
  | 'UPDATE_DOWNLOAD_CANCELED'
  | 'UPDATE_CANCEL_FAILED'
  | 'UPDATE_HASH_MISMATCH'
  | 'UPDATE_SIGNATURE_INVALID'
  | 'UPDATE_CORE_SHUTDOWN_FAILED'
  | 'UPDATE_INSTALL_SUMMARY_STALE'
  | 'UPDATE_INSTALL_START_FAILED'

export interface UpdatePreferences {
  automatic_check: boolean
  check_interval: UpdateCheckInterval
  automatic_download: boolean
  last_checked_at: string | null
  revision: number
}

export type UpdatePreferencesPatch = Partial<
  Pick<UpdatePreferences, 'automatic_check' | 'check_interval' | 'automatic_download'>
>

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytes_per_second: number
}

export interface UpdateReleaseInfo {
  version: string
  release_name?: string | null
  release_date?: string | null
  release_notes?: string | null
}

export interface UpdateApplicationInfo {
  product_name: string
  version: string
  platform: string
  arch: string
  packaged: boolean
}

export interface UpdateSnapshot {
  state_seq: number
  operation_generation: number
  phase: UpdatePhase
  current_version: string
  available_version: string | null
  release_name: string | null
  release_date: string | null
  release_notes: string | null
  progress: UpdateProgress | null
  checked_at: string | null
  error_code: UpdateErrorCode | null
  error_message: string | null
  retryable: boolean
  support_reason: string | null
  preferences: UpdatePreferences
  next_automatic_check_at: string | null
}

export interface UpdateSupport {
  supported: boolean
  reason?: string | null
}

export interface UpdateCheckResult {
  update_available: boolean
  release?: UpdateReleaseInfo | null
}

export interface UpdateDownloadProgress {
  percent?: number
  transferred?: number
  total?: number
  bytes_per_second?: number
}

export interface UpdateDownloadContext {
  generation: number
  signal: AbortSignal
  onProgress: (progress: UpdateDownloadProgress) => void
}

export interface UpdateEngine {
  readonly currentVersion: string
  readonly support: UpdateSupport
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: (context: UpdateDownloadContext) => Promise<void>
  cancelDownload: (generation: number) => Promise<void>
  installUpdate: () => Promise<void>
}

export interface InstallLifecycle {
  prepareForInstall: () => Promise<void>
  recoverFromInstallFailure?: () => Promise<boolean>
}

export interface UpdateManagerLogger {
  info: (event: string, details?: Record<string, unknown>) => void
  error: (event: string, details?: Record<string, unknown>) => void
}

export interface UpdateManagerOptions {
  engine: UpdateEngine
  installLifecycle: InstallLifecycle
  preferences?: UpdatePreferences
  now?: () => number
  logger?: UpdateManagerLogger
  persistPreferences?: (
    preferences: UpdatePreferences,
  ) => Promise<UpdatePreferences | void>
}

export interface UpdateRuntimeSummary {
  ssh_sessions: number
  file_sessions: number
  forwards: number
  transfers: number
  transfers_complete: boolean
}

export interface UpdateInstallConfirmation {
  confirmation_token: string
  expires_at: string
  state_seq: number
  operation_generation: number
  summary_revision: number
  summary: UpdateRuntimeSummary
}

export interface UpdateInstallSummaryState {
  revision: number
  ready: boolean
}

export interface UpdateRuntimeSummaryRefreshRequest {
  request_id: string
  document_epoch: string
}

export interface UpdateRuntimeSummaryReportContext {
  request_id?: string
  document_epoch: string
}

export type UpdateWindowTheme = AppTheme
export type UpdateWindowLanguage = AppLanguage

export interface UpdateWindowBootstrap<TSnapshot = unknown> {
  bootstrap_seq: number
  language: UpdateWindowLanguage
  snapshot: TSnapshot
  theme: UpdateWindowTheme
}
