import type {
  AppBuildInfo,
  AppConfig,
  CoreFatalEvent,
  CoreStatus,
  DataPortabilityExportDialogResult,
  DataPortabilityImportDialogResult,
  DataPortabilityProgress,
  DataPortabilityRestartResult,
  TrayCommand,
  TrayMenuState,
} from './domain'

declare global {
  interface Window {
    termous?: {
      getConfig: () => Promise<Partial<AppConfig>>
      getBuildInfo: () => Promise<AppBuildInfo>
      platform: string
      core?: {
        status: () => Promise<CoreStatus>
        shutdown: () => Promise<boolean>
        getFatal: () => Promise<CoreFatalEvent | null>
        onFatal: (callback: (event: CoreFatalEvent) => void) => () => void
      }
      startup?: {
        ready: () => Promise<boolean>
      }
      appearance?: {
        setTheme: (theme: 'dark' | 'light') => Promise<boolean>
      }
      portability?: {
        exportBackup: (password: string) => Promise<DataPortabilityExportDialogResult>
        inspectBackup: (password: string) => Promise<DataPortabilityImportDialogResult>
        restartAfterRestore: () => Promise<DataPortabilityRestartResult>
        onProgress: (callback: (progress: DataPortabilityProgress) => void) => () => void
      }
      clipboard?: {
        readText: () => Promise<string>
        writeText: (text: string) => Promise<boolean>
      }
      windowControls?: {
        minimize: () => Promise<boolean>
        toggleMaximize: () => Promise<boolean>
        requestClose: () => Promise<boolean>
        minimizeToTray: () => Promise<boolean>
        confirmClose: () => Promise<boolean>
        isMaximized: () => Promise<boolean>
        onMaximizeState: (callback: (maximized: boolean) => void) => () => void
        onCloseRequest: (callback: () => void) => () => void
      }
      tray?: {
        updateState: (state: TrayMenuState) => Promise<boolean>
        onCommand: (callback: (command: TrayCommand) => void) => () => void
      }
      files?: {
        pickPaths: (options?: {
          mode?: 'files' | 'directories' | 'files-and-directories'
          multiple?: boolean
        }) => Promise<string[]>
        pickFiles: () => Promise<string[]>
        pickDirectory: () => Promise<string[]>
        openDirectory: (localPath: string) => Promise<{ ok: boolean; error?: string }>
        pathsFromFileList: (files: ArrayLike<File>) => Promise<string[]>
        consumeDroppedFilePaths: (fileCount?: number) => Promise<string[]>
        readClipboardFilePaths: () => Promise<string[]>
      }
    }
  }
}

export {}
