import type { AppConfig } from './domain'

declare global {
  interface Window {
    termous?: {
      getConfig: () => Promise<Partial<AppConfig>>
      platform: string
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
