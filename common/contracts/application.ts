import type { CoreStartupSnapshot } from './startup'

export type AppLanguage = 'zh-CN' | 'en-US'

export type AppTheme = 'dark' | 'light'

export const appDebugModeArgument = '--termous-debug'

export interface AppConfig {
  apiBaseUrl: string
  apiToken: string
  version?: string
  managed?: boolean
}

export interface AppBuildInfo {
  product_name: string
  version: string
  core_version: string | null
  platform: string
  arch: string
  channel: 'production' | 'development'
  packaged: boolean
  update_supported: boolean
  update_support_reason: string | null
}

export function decodeAppBuildInfo(input: unknown): AppBuildInfo {
  if (!input || typeof input !== 'object') throw new Error('APP_BUILD_INFO_INVALID')
  const value = input as Record<string, unknown>
  if ((value.channel !== 'production' && value.channel !== 'development')
    || ['product_name', 'version', 'platform', 'arch'].some(key => typeof value[key] !== 'string')
    || (value.core_version !== null && typeof value.core_version !== 'string')
    || typeof value.packaged !== 'boolean' || typeof value.update_supported !== 'boolean'
    || (value.update_support_reason !== null && typeof value.update_support_reason !== 'string')) throw new Error('APP_BUILD_INFO_INVALID')
  return value as unknown as AppBuildInfo
}

export interface CoreFatalEvent {
  title: string
  message: string
  code: string
  details?: string
}

export interface CoreStatus {
  config: AppConfig
  fatal: CoreFatalEvent | null
  pid?: number
  startup: CoreStartupSnapshot
}

export interface TrayRecentHost {
  id: string
  name: string
}

export interface TrayMenuLabels {
  openApp: string
  connectHost: string
  recentHosts: string
  emptyRecentHosts: string
  forwards: string
  updateAvailable: string
  updateDownloading: string
  updateDownloaded: string
  quit: string
}

export interface TrayMenuState {
  language: AppLanguage
  recentHosts: TrayRecentHost[]
  labels: TrayMenuLabels
}

export type TrayCommand =
  | { type: 'open-app' }
  | { type: 'open-host-launcher' }
  | { type: 'connect-recent-host'; hostId: string }
  | { type: 'open-forwards' }

export interface SSHPrivateKeySelectionResult {
  canceled: boolean
  file_name?: string
  private_key?: string
}

export interface SSHKeyFileSaveResult {
  canceled: boolean
  file_name?: string
  public_file_name?: string
}
