import { createContext, useContext } from 'react'
import type { RemoteDirectoryViewState } from './filesWorkspaceState'
import type { PendingFileOperation } from './transferQueueState'

export type FilesWorkspaceSessionStateUpdater = (
  current: RemoteDirectoryViewState,
) => RemoteDirectoryViewState

export interface FilesWorkspaceUploadRefreshTarget {
  fileSessionId: string
  targetPath: string
}

export interface FilesWorkspaceRuntimeValue {
  states: Record<string, RemoteDirectoryViewState>
  pendingTransferOperations: PendingFileOperation[]
  pendingTransferActionIds: ReadonlySet<string>
  updateSession: (
    fileSessionId: string,
    initialPath: string,
    updater: FilesWorkspaceSessionStateUpdater,
  ) => void
  updateExistingSession: (
    fileSessionId: string,
    updater: FilesWorkspaceSessionStateUpdater,
  ) => void
  removeSession: (fileSessionId: string) => void
  adoptSession: (
    sourceFileSessionId: string,
    targetFileSessionId: string,
    initialPath: string,
  ) => void
  retainSessions: (fileSessionIds: ReadonlySet<string>) => void
  startPendingTransferOperation: (
    operation: Omit<PendingFileOperation, 'id'>,
  ) => string
  updatePendingTransferOperation: (
    id: string,
    patch: Partial<PendingFileOperation>,
  ) => void
  removePendingTransferOperation: (id: string) => void
  beginPendingTransferAction: (id: string) => boolean
  endPendingTransferAction: (id: string) => void
  trackUploadRefreshTask: (
    taskId: string,
    target: FilesWorkspaceUploadRefreshTarget,
  ) => void
  hasUploadRefreshTask: (taskId: string) => boolean
  consumeUploadRefreshTask: (taskId: string) => FilesWorkspaceUploadRefreshTarget | null
  pruneUploadRefreshTasks: (taskIds: ReadonlySet<string>) => void
  markDirectoryDirty: (fileSessionId: string, path: string) => void
  clearDirectoryDirty: (fileSessionId: string, path: string) => void
  isDirectoryDirty: (fileSessionId: string, path: string) => boolean
}

export const FilesWorkspaceRuntimeContext = createContext<FilesWorkspaceRuntimeValue | null>(null)

export function useFilesWorkspaceRuntime() {
  const value = useContext(FilesWorkspaceRuntimeContext)
  if (!value) {
    throw new Error('FilesWorkspaceRuntimeProvider 未挂载')
  }
  return value
}
