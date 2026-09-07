import type {
  AgentRuntimeCommandResult,
  AgentQueuedTurnSteerRequest,
  AgentRuntimeRunRef,
  AgentRuntimeStatus,
  AgentRuntimeSteerRequest,
} from './agent-runtime'
import type {
  AppBuildInfo,
  AppConfig,
  AppTheme,
  CoreFatalEvent,
  CoreStatus,
  SSHKeyFileSaveResult,
  SSHPrivateKeySelectionResult,
  TrayCommand,
  TrayMenuState,
} from './application'
import type {
  DataPortabilityExportDialogResult,
  DataPortabilityImportDialogResult,
  DataPortabilityImportSelectionResult,
  DataPortabilityProgress,
  DataPortabilityRestartResult,
} from './data-portability'
import type { ExternalUrlOpenResult } from './external'
import type {
  UpdateApplicationInfo,
  UpdateInstallConfirmation,
  UpdateInstallSummaryState,
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateRuntimeSummary,
  UpdateRuntimeSummaryRefreshRequest,
  UpdateRuntimeSummaryReportContext,
  UpdateSnapshot,
  UpdateWindowBootstrap,
} from './update'

export type FilePickerMode = 'files' | 'directories' | 'files-and-directories'

export interface FilePickerOptions {
  mode?: FilePickerMode
  multiple?: boolean
}

export interface OpenLocalDirectoryResult {
  ok: boolean
  error?: string
}

export interface TermousBridge {
  getConfig: () => Promise<Partial<AppConfig>>
  getBuildInfo: () => Promise<AppBuildInfo>
  platform: string
  core?: {
    status: () => Promise<CoreStatus>
    shutdown: () => Promise<boolean>
    getFatal: () => Promise<CoreFatalEvent | null>
    onFatal: (callback: (event: CoreFatalEvent) => void) => () => void
  }
  agentRuntime?: {
    getStatus: () => Promise<AgentRuntimeStatus>
    start: (request: AgentRuntimeRunRef) => Promise<AgentRuntimeCommandResult>
    stop: (request: AgentRuntimeRunRef) => Promise<AgentRuntimeCommandResult>
    steer: (request: AgentRuntimeSteerRequest) => Promise<AgentRuntimeCommandResult>
    wake: () => Promise<AgentRuntimeCommandResult>
    steerQueuedTurn: (request: AgentQueuedTurnSteerRequest) => Promise<AgentRuntimeCommandResult>
    onStatus: (callback: (status: AgentRuntimeStatus) => void) => () => void
  }
  startup?: {
    ready: () => Promise<boolean>
  }
  appearance?: {
    setTheme: (theme: AppTheme) => Promise<boolean>
  }
  portability?: {
    exportBackup: (password: string) => Promise<DataPortabilityExportDialogResult>
    selectBackup: () => Promise<DataPortabilityImportSelectionResult>
    inspectBackup: (
      selectionId: string,
      password: string,
    ) => Promise<DataPortabilityImportDialogResult>
    restartAfterRestore: () => Promise<DataPortabilityRestartResult>
    onProgress: (callback: (progress: DataPortabilityProgress) => void) => () => void
  }
  clipboard?: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<boolean>
  }
  external?: {
    openUrl: (url: string) => Promise<ExternalUrlOpenResult>
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
    pickPaths: (options?: FilePickerOptions) => Promise<string[]>
    pickFiles: () => Promise<string[]>
    pickDirectory: () => Promise<string[]>
    openDirectory: (localPath: string) => Promise<OpenLocalDirectoryResult>
    pathsFromFileList: (files: ArrayLike<File>) => Promise<string[]>
    consumeDroppedFilePaths: (fileCount?: number) => Promise<string[]>
    readClipboardFilePaths: () => Promise<string[]>
  }
  updates?: {
    getState: () => Promise<UpdateSnapshot>
    getPreferences: () => Promise<UpdatePreferences>
    setPreferences: (patch: UpdatePreferencesPatch) => Promise<UpdatePreferences>
    openWindow: () => Promise<boolean>
    reportRuntimeSummary: (
      summary: UpdateRuntimeSummary,
      context?: UpdateRuntimeSummaryReportContext,
    ) => Promise<UpdateRuntimeSummary>
    onRuntimeSummaryRequested: (
      callback: (request: UpdateRuntimeSummaryRefreshRequest) => void,
    ) => () => void
    subscribe: (callback: (snapshot: UpdateSnapshot) => void) => () => void
  }
  sshKeys?: {
    selectPrivateKey: () => Promise<SSHPrivateKeySelectionResult>
    savePublicKey: (input: {
      suggestedName: string
      content: string
    }) => Promise<SSHKeyFileSaveResult>
    saveKeyPair: (input: {
      suggestedName: string
      privateKey: string
      publicKey: string
    }) => Promise<SSHKeyFileSaveResult>
  }
}

export interface TermousUpdateWindowBridge {
  cancelDownload(): Promise<UpdateSnapshot>
  check(): Promise<UpdateSnapshot>
  close(): Promise<boolean>
  download(): Promise<UpdateSnapshot>
  getApplicationInfo(): Promise<UpdateApplicationInfo>
  getBootstrap(): Promise<UpdateWindowBootstrap<UpdateSnapshot>>
  getState(): Promise<UpdateSnapshot>
  install(confirmationToken: string): Promise<UpdateSnapshot>
  minimize(): Promise<boolean>
  onInstallSummaryChanged(
    callback: (state: UpdateInstallSummaryState) => void,
  ): () => void
  onBootstrapChanged(
    callback: (bootstrap: UpdateWindowBootstrap<UpdateSnapshot>) => void,
  ): () => void
  prepareInstall(): Promise<UpdateInstallConfirmation>
  subscribe(callback: (snapshot: UpdateSnapshot) => void): () => void
}
