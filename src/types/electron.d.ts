import type { AppConfig } from './domain'

declare global {
  interface Window {
    termous?: {
      getConfig: () => Promise<Partial<AppConfig>>
      platform: string
      clipboard?: {
        readText: () => Promise<string>
        writeText: (text: string) => Promise<boolean>
      }
      windowControls?: {
        minimize: () => Promise<boolean>
        toggleMaximize: () => Promise<boolean>
        requestClose: () => Promise<boolean>
        confirmClose: () => Promise<boolean>
        isMaximized: () => Promise<boolean>
        onMaximizeState: (callback: (maximized: boolean) => void) => () => void
        onCloseRequest: (callback: () => void) => () => void
      }
    }
  }
}

export {}
