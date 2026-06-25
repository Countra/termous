import type { AppConfig } from './domain'

declare global {
  interface Window {
    termous?: {
      getConfig: () => Promise<Partial<AppConfig>>
      platform: string
      windowControls?: {
        minimize: () => Promise<void>
        toggleMaximize: () => Promise<boolean>
        requestClose: () => Promise<void>
        confirmClose: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizeState: (callback: (maximized: boolean) => void) => () => void
        onCloseRequest: (callback: () => void) => () => void
      }
    }
  }
}

export {}
