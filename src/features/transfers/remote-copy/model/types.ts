import type {
  FileSession,
  RemoteDirectoryListing,
  RemoteFileEntry,
  RemoteCopyTargetDirMode,
  TransferTask,
} from '#entities/file'
import type { Host } from '#entities/host'

export type RemoteCopyConflictPolicy = 'rename' | 'skip' | 'overwrite'
export type RemoteCopyMode = 'single' | 'batch'

export const remoteCopyBatchTargetLimit = 16

export interface RemoteCopySourceSnapshot {
  hostId: string
  fileSessionId: string
  connectionGeneration: number
  entries: readonly RemoteFileEntry[]
}

export interface RemoteCopyDirectoryRequest {
  fileSessionId: string
  path: string
  rememberPath: false
  signal: AbortSignal
}

export type RemoteCopyListDirectories = (
  request: RemoteCopyDirectoryRequest,
) => Promise<RemoteDirectoryListing>

export interface RemoteCopyCreateDirectoryRequest {
  fileSessionId: string
  connectionGeneration: number
  path: string
}

export type RemoteCopyCreateDirectory = (
  request: RemoteCopyCreateDirectoryRequest,
) => Promise<void>

export interface RemoteCopyCreateRequest {
  sourceFileSessionId: string
  sourceConnectionGeneration: number
  targetFileSessionId: string
  targetConnectionGeneration: number
  sourcePaths: string[]
  targetDir: string
  targetDirMode: RemoteCopyTargetDirMode
  overwritePolicy: RemoteCopyConflictPolicy
}

export type RemoteCopyCreate = (
  request: RemoteCopyCreateRequest,
) => Promise<TransferTask>

export type RemoteCopyOverwriteConfirmation =
  | {
      mode: 'single'
      sourceCount: number
      targetHostName: string
      targetPath: string
    }
  | {
      mode: 'batch'
      sourceCount: number
      targetCount: number
      targetPath: string
    }

export interface RemoteCopyBatchFailure {
  sessionId: string
  hostId: string
  hostName: string
  message: string
  retryable: boolean
}

export interface RemoteCopyBatchOutcome {
  createdCount: number
  failures: RemoteCopyBatchFailure[]
}

export interface RemoteCopyTargetSession {
  host: Host
  session: FileSession & { connection_generation: number }
  shortSessionId: string
  duplicateHostSession: boolean
}

export interface RemoteCopyModalProps {
  open: boolean
  source: RemoteCopySourceSnapshot
  hosts: readonly Host[]
  fileSessions: readonly FileSession[]
  getHostIconUrl: (iconId: string) => string
  listDirectories: RemoteCopyListDirectories
  createDirectory: RemoteCopyCreateDirectory
  createRemoteCopy: RemoteCopyCreate
  confirmOverwrite: (
    confirmation: RemoteCopyOverwriteConfirmation,
  ) => Promise<boolean>
  onCreated: (tasks: TransferTask[]) => void
  onClose: () => void
}

export type RemoteCopySourceValidation =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'unsupported' }

export interface RemoteCopyBreadcrumb {
  label: string
  path: string
}
