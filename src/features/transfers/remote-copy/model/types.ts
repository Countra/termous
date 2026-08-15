import type {
  FileSession,
  RemoteDirectoryListing,
  RemoteFileEntry,
  TransferTask,
} from '#entities/file'
import type { Host } from '#entities/host'

export type RemoteCopyConflictPolicy = 'rename' | 'skip' | 'overwrite'

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
  overwritePolicy: RemoteCopyConflictPolicy
}

export type RemoteCopyCreate = (
  request: RemoteCopyCreateRequest,
) => Promise<TransferTask>

export interface RemoteCopyOverwriteConfirmation {
  sourceCount: number
  targetHostName: string
  targetPath: string
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
  onCreated: (task: TransferTask) => void
  onClose: () => void
}

export type RemoteCopySourceValidation =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'unsupported' }

export interface RemoteCopyBreadcrumb {
  label: string
  path: string
}
