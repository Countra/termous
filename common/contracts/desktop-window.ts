import type { AppConfig, AppLanguage, AppTheme } from './application'
import type { FilePickerOptions } from './bridge'

export interface DesktopWindowBootstrap {
  config: AppConfig
  sessionId: string
  language: AppLanguage
  theme: AppTheme
}

export interface DesktopWindowBridge {
  pickPaths?: (options: FilePickerOptions) => Promise<string[]>
  bootstrap: () => Promise<DesktopWindowBootstrap>
  close: () => Promise<void>
}
