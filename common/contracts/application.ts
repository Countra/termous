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
  packaged: boolean
  update_supported: boolean
  update_support_reason: string | null
}

export interface CoreFatalEvent {
  title: string
  message: string
  code: string
}

export interface CoreStatus {
  config: AppConfig
  fatal: CoreFatalEvent | null
  pid?: number
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
  language: 'zh-CN' | 'en-US'
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
