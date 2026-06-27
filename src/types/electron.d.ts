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
      files?: {
        pickPaths: (options?: {
          mode?: 'files' | 'directories' | 'files-and-directories'
          multiple?: boolean
        }) => Promise<string[]>
        pickFiles: () => Promise<string[]>
        pickDirectory: () => Promise<string[]>
        pathsFromFileList: (files: ArrayLike<File>) => Promise<string[]>
        readClipboardFilePaths: () => Promise<string[]>
      }
    }
  }
}

export {}
