import type {
  AppBuildInfo,
  AppConfig,
  CoreFatalEvent,
  CoreStatus,
  DataPortabilityExportDialogResult,
  DataPortabilityImportDialogResult,
  DataPortabilityImportSelectionResult,
  DataPortabilityProgress,
  DataPortabilityRestartResult,
  TrayCommand,
  TrayMenuState,
} from './domain'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '../../electron/updateManager'
import type { UpdateRuntimeSummary } from '../../electron/updateRuntime'
import type { UpdateWindowIntent } from '../../electron/updateWindow'

interface SSHPrivateKeySelectionResult {
  canceled: boolean
  file_name?: string
  private_key?: string
}

interface SSHKeyFileSaveResult {
  canceled: boolean
  file_name?: string
  public_file_name?: string
}

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
        selectBackup: () => Promise<DataPortabilityImportSelectionResult>
        inspectBackup: (selectionId: string, password: string) => Promise<DataPortabilityImportDialogResult>
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
      updates?: {
        getState: () => Promise<UpdateSnapshot>
        getPreferences: () => Promise<UpdatePreferences>
        setPreferences: (patch: UpdatePreferencesPatch) => Promise<UpdatePreferences>
        check: () => Promise<UpdateSnapshot>
        openWindow: (intent?: UpdateWindowIntent) => Promise<boolean>
        openReleasePage: () => Promise<boolean>
        reportRuntimeSummary: (summary: UpdateRuntimeSummary) => Promise<UpdateRuntimeSummary>
        subscribe: (callback: (snapshot: UpdateSnapshot) => void) => () => void
      }
      sshKeys?: {
        selectPrivateKey: () => Promise<SSHPrivateKeySelectionResult>
        savePublicKey: (input: { suggestedName: string; content: string }) => Promise<SSHKeyFileSaveResult>
        saveKeyPair: (input: {
          suggestedName: string
          privateKey: string
          publicKey: string
        }) => Promise<SSHKeyFileSaveResult>
      }
    }
  }
}

export {}
