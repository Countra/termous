import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FileSession } from '#entities/file'
import { useFileSessionTabActions } from './useFileSessionTabActions'
import { DirectorySizeResultCache } from '#features/remote-file'
import {
  getFilesWorkspaceSessionState,
  removeFilesWorkspaceSessionState,
  retainFilesWorkspaceSessionStates,
  setFilesWorkspaceSessionState,
  type FilesWorkspaceRuntimeState,
} from './filesWorkspaceState'
import {
  FilesWorkspaceRuntimeContext,
  type FilesWorkspaceRuntimeValue,
  type FilesWorkspaceSessionStateUpdater,
  type FilesWorkspaceUploadRefreshTarget,
} from './useFilesWorkspaceRuntime'
import {
  limitPendingFileOperations,
  type PendingFileOperation,
} from '#features/transfers'

export function FilesWorkspaceRuntimeProvider({
  children,
  fileSessions,
  tabSessions = fileSessions,
  closingFileSessionIds,
}: {
  children: ReactNode
  fileSessions?: readonly FileSession[]
  tabSessions?: readonly FileSession[]
  closingFileSessionIds?: readonly string[]
}) {
  const sessionTabs = useFileSessionTabActions(tabSessions)
  const [states, setStates] = useState<FilesWorkspaceRuntimeState>({})
  const [directorySizeCache] = useState(() => new DirectorySizeResultCache())
  const [pendingTransferOperations, setPendingTransferOperations] = useState<PendingFileOperation[]>([])
  const [pendingTransferActionIds, setPendingTransferActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const pendingTransferActionIdsRef = useRef(new Set<string>())
  const pendingOperationSequenceRef = useRef(0)
  const uploadRefreshTargetsRef = useRef(new Map<string, FilesWorkspaceUploadRefreshTarget>())
  const consumedUploadRefreshTaskIdsRef = useRef(new Set<string>())
  const dirtyDirectoryPathsRef = useRef(new Map<string, Set<string>>())

  useEffect(() => {
    if (!fileSessions) {
      return
    }
    const closingSessionIds = new Set(closingFileSessionIds ?? [])
    directorySizeCache.retainSessions(fileSessions.map((session) => ({
      id: session.id,
      connectionGeneration: session.connection_generation ?? 0,
      closing: closingSessionIds.has(session.id),
    })))
  }, [closingFileSessionIds, directorySizeCache, fileSessions])

  const updateSession = useCallback((
    fileSessionId: string,
    initialPath: string,
    updater: FilesWorkspaceSessionStateUpdater,
  ) => {
    if (!fileSessionId) {
      return
    }
    setStates((current) => {
      const previous = getFilesWorkspaceSessionState(
        current,
        fileSessionId,
        initialPath,
      )
      const next = updater(previous)
      return setFilesWorkspaceSessionState(current, fileSessionId, next)
    })
  }, [])

  const updateExistingSession = useCallback((
    fileSessionId: string,
    updater: FilesWorkspaceSessionStateUpdater,
  ) => {
    if (!fileSessionId) {
      return
    }
    setStates((current) => {
      const previous = current[fileSessionId]
      if (!previous) {
        return current
      }
      const next = updater(previous)
      return setFilesWorkspaceSessionState(current, fileSessionId, next)
    })
  }, [])

  const removeSession = useCallback((fileSessionId: string) => {
    setStates((current) => removeFilesWorkspaceSessionState(current, fileSessionId))
    dirtyDirectoryPathsRef.current.delete(fileSessionId)
    directorySizeCache.clearSession(fileSessionId)
  }, [directorySizeCache])

  const adoptSession = useCallback((
    sourceFileSessionId: string,
    targetFileSessionId: string,
    initialPath: string,
  ) => {
    if (!sourceFileSessionId || !targetFileSessionId || sourceFileSessionId === targetFileSessionId) {
      return
    }
    directorySizeCache.clearSession(sourceFileSessionId)
    directorySizeCache.clearSession(targetFileSessionId)
    setStates((current) => {
      const source = current[sourceFileSessionId]
      if (!source) {
        return current
      }
      const adopted = setFilesWorkspaceSessionState(
        current,
        targetFileSessionId,
        {
          ...source,
          committedPath: source.committedPath || initialPath,
          pendingPath: null,
          directoryStatus: 'idle',
          activeRequest: null,
        },
      )
      return removeFilesWorkspaceSessionState(adopted, sourceFileSessionId)
    })
    setPendingTransferOperations((current) => current.map((operation) => (
      operation.fileSessionId === sourceFileSessionId
        ? { ...operation, fileSessionId: targetFileSessionId }
        : operation
    )))
    const dirtyPaths = dirtyDirectoryPathsRef.current.get(sourceFileSessionId)
    if (dirtyPaths) {
      dirtyDirectoryPathsRef.current.delete(sourceFileSessionId)
      dirtyDirectoryPathsRef.current.set(targetFileSessionId, dirtyPaths)
    }
    uploadRefreshTargetsRef.current.forEach((target, taskId) => {
      if (target.fileSessionId === sourceFileSessionId) {
        uploadRefreshTargetsRef.current.set(taskId, {
          ...target,
          fileSessionId: targetFileSessionId,
        })
      }
    })
  }, [directorySizeCache])

  const retainSessions = useCallback((fileSessionIds: ReadonlySet<string>) => {
    setStates((current) => retainFilesWorkspaceSessionStates(current, fileSessionIds))
    dirtyDirectoryPathsRef.current.forEach((_paths, fileSessionId) => {
      if (!fileSessionIds.has(fileSessionId)) {
        dirtyDirectoryPathsRef.current.delete(fileSessionId)
      }
    })
  }, [])

  const startPendingTransferOperation = useCallback((
    operation: Omit<PendingFileOperation, 'id'>,
  ) => {
    pendingOperationSequenceRef.current += 1
    const id = `file-op-${Date.now()}-${pendingOperationSequenceRef.current}`
    setPendingTransferOperations((current) => limitPendingFileOperations([
      { ...operation, id },
      ...current,
    ]))
    return id
  }, [])

  const updatePendingTransferOperation = useCallback((
    id: string,
    patch: Partial<PendingFileOperation>,
  ) => {
    setPendingTransferOperations((current) => limitPendingFileOperations(
      current.map((operation) => (
        operation.id === id ? { ...operation, ...patch } : operation
      )),
    ))
  }, [])

  const removePendingTransferOperation = useCallback((id: string) => {
    setPendingTransferOperations((current) => current.filter((operation) => operation.id !== id))
  }, [])

  const beginPendingTransferAction = useCallback((id: string) => {
    if (pendingTransferActionIdsRef.current.has(id)) {
      return false
    }
    pendingTransferActionIdsRef.current.add(id)
    setPendingTransferActionIds(new Set(pendingTransferActionIdsRef.current))
    return true
  }, [])

  const endPendingTransferAction = useCallback((id: string) => {
    pendingTransferActionIdsRef.current.delete(id)
    setPendingTransferActionIds(new Set(pendingTransferActionIdsRef.current))
  }, [])

  const trackUploadRefreshTask = useCallback((
    taskId: string,
    target: FilesWorkspaceUploadRefreshTarget,
  ) => {
    if (!taskId || consumedUploadRefreshTaskIdsRef.current.has(taskId)) {
      return
    }
    uploadRefreshTargetsRef.current.set(taskId, target)
  }, [])

  const hasUploadRefreshTask = useCallback((taskId: string) => (
    uploadRefreshTargetsRef.current.has(taskId)
  ), [])

  const consumeUploadRefreshTask = useCallback((taskId: string) => {
    const target = uploadRefreshTargetsRef.current.get(taskId)
    uploadRefreshTargetsRef.current.delete(taskId)
    consumedUploadRefreshTaskIdsRef.current.add(taskId)
    return target ?? null
  }, [])

  const pruneUploadRefreshTasks = useCallback((taskIds: ReadonlySet<string>) => {
    uploadRefreshTargetsRef.current.forEach((_target, taskId) => {
      if (!taskIds.has(taskId)) {
        uploadRefreshTargetsRef.current.delete(taskId)
      }
    })
    consumedUploadRefreshTaskIdsRef.current.forEach((taskId) => {
      if (!taskIds.has(taskId)) {
        consumedUploadRefreshTaskIdsRef.current.delete(taskId)
      }
    })
  }, [])

  const markDirectoryDirty = useCallback((fileSessionId: string, path: string) => {
    const paths = dirtyDirectoryPathsRef.current.get(fileSessionId) ?? new Set<string>()
    paths.add(path)
    dirtyDirectoryPathsRef.current.set(fileSessionId, paths)
  }, [])

  const clearDirectoryDirty = useCallback((fileSessionId: string, path: string) => {
    const paths = dirtyDirectoryPathsRef.current.get(fileSessionId)
    if (!paths) {
      return
    }
    paths.delete(path)
    if (paths.size === 0) {
      dirtyDirectoryPathsRef.current.delete(fileSessionId)
    }
  }, [])

  const isDirectoryDirty = useCallback((fileSessionId: string, path: string) => (
    dirtyDirectoryPathsRef.current.get(fileSessionId)?.has(path) ?? false
  ), [])

  const value = useMemo<FilesWorkspaceRuntimeValue>(() => ({
    sessionTabs,
    states,
    directorySizeCache,
    pendingTransferOperations,
    pendingTransferActionIds,
    updateSession,
    updateExistingSession,
    removeSession,
    adoptSession,
    retainSessions,
    startPendingTransferOperation,
    updatePendingTransferOperation,
    removePendingTransferOperation,
    beginPendingTransferAction,
    endPendingTransferAction,
    trackUploadRefreshTask,
    hasUploadRefreshTask,
    consumeUploadRefreshTask,
    pruneUploadRefreshTasks,
    markDirectoryDirty,
    clearDirectoryDirty,
    isDirectoryDirty,
  }), [
    sessionTabs,
    adoptSession,
    beginPendingTransferAction,
    clearDirectoryDirty,
    consumeUploadRefreshTask,
    directorySizeCache,
    endPendingTransferAction,
    hasUploadRefreshTask,
    isDirectoryDirty,
    markDirectoryDirty,
    pendingTransferActionIds,
    pendingTransferOperations,
    pruneUploadRefreshTasks,
    removePendingTransferOperation,
    removeSession,
    retainSessions,
    startPendingTransferOperation,
    states,
    trackUploadRefreshTask,
    updateExistingSession,
    updatePendingTransferOperation,
    updateSession,
  ])

  return (
    <FilesWorkspaceRuntimeContext.Provider value={value}>
      {children}
    </FilesWorkspaceRuntimeContext.Provider>
  )
}
