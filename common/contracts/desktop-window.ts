import type { AppConfig, AppLanguage, AppTheme } from './application'

export interface DesktopWindowBootstrap {
  config: AppConfig
  sessionId: string
  language: AppLanguage
  theme: AppTheme
}

export interface DesktopWindowBridge {
  bootstrap: () => Promise<DesktopWindowBootstrap>
  close: () => Promise<void>
}
