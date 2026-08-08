import { useCallback, useEffect, useRef, useState } from 'react'
import type { TransferTask } from '#entities/file'
import type { LocalDownloadRefreshRequest } from '#features/local-download'
import { normalizeRemotePath } from '#shared/path'
import type { FilesDirectoryLoadOptions } from './useFilesDirectoryController'
import type { FilesWorkspaceRuntimeValue } from './useFilesWorkspaceRuntime'

interface FilesTransferRefreshActiveDirectory {
  fileSessionId: string
  path: string
  connected: boolean
}

interface UseFilesTransferRefreshOptions {
  transfers: readonly TransferTask[]
  activeDirectory: FilesTransferRefreshActiveDirectory | null
  loadDirectory: (
    path: string,
    options: FilesDirectoryLoadOptions,
  ) => Promise<boolean>
  trackWorkspaceUploadRefreshTask: FilesWorkspaceRuntimeValue['trackUploadRefreshTask']
  hasUploadRefreshTask: FilesWorkspaceRuntimeValue['hasUploadRefreshTask']
  consumeUploadRefreshTask: FilesWorkspaceRuntimeValue['consumeUploadRefreshTask']
  pruneUploadRefreshTasks: FilesWorkspaceRuntimeValue['pruneUploadRefreshTasks']
  markDirectoryDirty: FilesWorkspaceRuntimeValue['markDirectoryDirty']
}

interface DownloadRefreshTarget {
  mappingId?: string
  targetPath: string
}

export function useFilesTransferRefresh({
  transfers,
  activeDirectory,
  loadDirectory,
  trackWorkspaceUploadRefreshTask,
  hasUploadRefreshTask,
  consumeUploadRefreshTask,
  pruneUploadRefreshTasks,
  markDirectoryDirty,
}: UseFilesTransferRefreshOptions) {
  const downloadRefreshTasksRef = useRef(new Map<string, DownloadRefreshTarget>())
  const [localRefreshRequests, setLocalRefreshRequests] = useState<
    LocalDownloadRefreshRequest[]
  >([])

  const trackUploadRefreshTask = useCallback((task: TransferTask) => {
    if (!isUploadTransfer(task) || !task.file_session_id) {
      return
    }
    trackWorkspaceUploadRefreshTask(task.id, {
      fileSessionId: task.file_session_id,
      targetPath: normalizeRemotePath(task.target_path || '/'),
    })
  }, [trackWorkspaceUploadRefreshTask])

  const trackDownloadRefreshTask = useCallback((
    task: TransferTask,
    mappingId?: string,
  ) => {
    if (!isDownloadTransfer(task) || !task.target_path) {
      return
    }
    downloadRefreshTasksRef.current.set(task.id, {
      mappingId,
      targetPath: task.target_path,
    })
  }, [])

  useEffect(() => {
    const transferIds = new Set(transfers.map((task) => task.id))
    pruneUploadRefreshTasks(transferIds)
    const completedTargets = new Map<
      string,
      { fileSessionId: string; targetPath: string }
    >()
    transfers.forEach((task) => {
      if (!isUploadTransfer(task) || !task.file_session_id) {
        return
      }
      if (isFilesTransferActive(task)) {
        trackUploadRefreshTask(task)
      }
      if (!isTransferTerminal(task) || !hasUploadRefreshTask(task.id)) {
        return
      }
      const target = consumeUploadRefreshTask(task.id)
      if (task.status === 'completed' && target) {
        completedTargets.set(
          `${target.fileSessionId}\u0000${target.targetPath}`,
          target,
        )
      }
    })

    const activePath = activeDirectory
      ? normalizeRemotePath(activeDirectory.path)
      : ''
    completedTargets.forEach((target) => {
      markDirectoryDirty(target.fileSessionId, target.targetPath)
      if (
        activeDirectory?.connected
        && target.fileSessionId === activeDirectory.fileSessionId
        && target.targetPath === activePath
      ) {
        void loadDirectory(target.targetPath, {
          kind: 'refresh',
          quiet: true,
        })
      }
    })
  }, [
    activeDirectory,
    consumeUploadRefreshTask,
    hasUploadRefreshTask,
    loadDirectory,
    markDirectoryDirty,
    pruneUploadRefreshTasks,
    trackUploadRefreshTask,
    transfers,
  ])

  useEffect(() => {
    const transferById = new Map(transfers.map((task) => [task.id, task]))
    transfers.forEach((task) => {
      if (
        isDownloadTransfer(task)
        && task.target_path
        && (
          isFilesTransferActive(task)
          || downloadRefreshTasksRef.current.has(task.id)
        )
      ) {
        const existing = downloadRefreshTasksRef.current.get(task.id)
        downloadRefreshTasksRef.current.set(task.id, {
          mappingId: existing?.mappingId,
          targetPath: task.target_path,
        })
      }
    })

    const completedRequests: LocalDownloadRefreshRequest[] = []
    const taskIdsToDelete: string[] = []
    downloadRefreshTasksRef.current.forEach((target, taskId) => {
      const task = transferById.get(taskId)
      if (!task) {
        taskIdsToDelete.push(taskId)
        return
      }
      if (isFilesTransferActive(task)) {
        return
      }
      if (task.status === 'completed') {
        completedRequests.push({
          id: task.id,
          mappingId: target.mappingId,
          targetPath: target.targetPath,
        })
      }
      if (isTransferTerminal(task)) {
        taskIdsToDelete.push(taskId)
      }
    })

    taskIdsToDelete.forEach((taskId) => {
      downloadRefreshTasksRef.current.delete(taskId)
    })
    if (completedRequests.length > 0) {
      setLocalRefreshRequests((current) => [
        ...current,
        ...completedRequests,
      ].slice(-50))
    }
  }, [transfers])

  return {
    localRefreshRequests,
    trackUploadRefreshTask,
    trackDownloadRefreshTask,
  }
}

export function isFilesTransferActive(task: TransferTask) {
  return task.status === 'queued' || task.status === 'running'
}

function isUploadTransfer(task: TransferTask) {
  return task.type.startsWith('upload')
}

function isDownloadTransfer(task: TransferTask) {
  return task.type.startsWith('download')
}

function isTransferTerminal(task: TransferTask) {
  return task.status === 'completed'
    || task.status === 'failed'
    || task.status === 'cancelled'
}
