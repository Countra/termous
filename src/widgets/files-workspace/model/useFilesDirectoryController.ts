import { useCallback, useEffect, useRef } from 'react'
import type { FileSession } from '#entities/file'
import type { FileSessionGateway } from '#features/files'
import { normalizeRemotePosixPath } from '#shared/path'
import {
  beginFilesWorkspaceHistoryNavigation,
  beginFilesWorkspaceNavigation,
  beginFilesWorkspaceRefresh,
  canStartFilesWorkspaceDirectoryLoad,
  cancelFilesWorkspaceDirectoryRequest,
  completeFilesWorkspaceDirectoryRequest,
  failFilesWorkspaceDirectoryRequest,
  getFilesWorkspaceSessionState,
  isActiveFilesWorkspaceDirectoryResult,
  resolveFilesWorkspaceAutomaticDirectoryRequest,
  setFilesWorkspaceDirectoryStatus,
  type FilesWorkspaceHistoryMode,
  type FilesWorkspaceRuntimeState,
} from './filesWorkspaceState'
import type {
  FilesWorkspaceRuntimeValue,
  FilesWorkspaceSessionStateUpdater,
} from './useFilesWorkspaceRuntime'

const filesWorkspaceCacheMaxAgeMs = 5_000

interface LatestValue<T> {
  readonly current: T
}

export interface FilesDirectoryLoadOptions {
  kind?: 'navigate' | 'refresh'
  historyMode?: FilesWorkspaceHistoryMode
  historyIndex?: number
  quiet?: boolean
  onError?: (description: string) => void
}

interface UseFilesDirectoryControllerOptions {
  gateway: Pick<FileSessionGateway, 'listFileSessionFiles'>
  activeFileSession: FileSession | null
  activeFileSessionId: string
  activeFileSessionClosing: boolean
  activeFileSessionRecovering: boolean
  fileSessions: readonly FileSession[]
  closingFileSessionIds: ReadonlySet<string>
  fileSessionsRef: LatestValue<readonly FileSession[]>
  workspaceStatesRef: LatestValue<FilesWorkspaceRuntimeState>
  activeFileSessionIdRef: LatestValue<string>
  closingFileSessionIdsRef: LatestValue<ReadonlySet<string>>
  updateSession: FilesWorkspaceRuntimeValue['updateSession']
  updateExistingSession: FilesWorkspaceRuntimeValue['updateExistingSession']
  updateActiveSession: (updater: FilesWorkspaceSessionStateUpdater) => void
  clearDirectoryDirty: FilesWorkspaceRuntimeValue['clearDirectoryDirty']
  isDirectoryDirty: FilesWorkspaceRuntimeValue['isDirectoryDirty']
  unknownErrorMessage: string
  onInvalidPath: () => void
  onDirectoryReadFailed: (description: string) => void
  onActiveDirectoryCommitted: () => void
}

export function useFilesDirectoryController({
  gateway,
  activeFileSession,
  activeFileSessionId,
  activeFileSessionClosing,
  activeFileSessionRecovering,
  fileSessions,
  closingFileSessionIds,
  fileSessionsRef,
  workspaceStatesRef,
  activeFileSessionIdRef,
  closingFileSessionIdsRef,
  updateSession,
  updateExistingSession,
  updateActiveSession,
  clearDirectoryDirty,
  isDirectoryDirty,
  unknownErrorMessage,
  onInvalidPath,
  onDirectoryReadFailed,
  onActiveDirectoryCommitted,
}: UseFilesDirectoryControllerOptions) {
  const requestControllersRef = useRef(new Map<string, {
    controller: AbortController
    connectionGeneration: number
  }>())
  const lastAutomaticLoadKeyRef = useRef('')

  const loadDirectory = useCallback(
    async (nextPath: string, options: FilesDirectoryLoadOptions = {}) => {
      if (!activeFileSession) {
        return false
      }
      const requestSession = fileSessionsRef.current.find(
        (session) => session.id === activeFileSession.id,
      )
      if (
        !requestSession
        || activeFileSessionIdRef.current !== activeFileSession.id
        || requestSession.status !== 'connected'
        || (requestSession.connection_generation ?? 0)
          !== (activeFileSession.connection_generation ?? 0)
        || closingFileSessionIdsRef.current.has(requestSession.id)
      ) {
        return false
      }
      const normalized = normalizeRemotePosixPath(nextPath)
      if (!normalized) {
        onInvalidPath()
        return false
      }

      const currentState = getFilesWorkspaceSessionState(
        workspaceStatesRef.current,
        requestSession.id,
        requestSession.current_path || '/',
      )
      const request = options.historyMode === 'traverse'
        ? beginFilesWorkspaceHistoryNavigation(
            currentState,
            options.historyIndex ?? currentState.historyIndex,
          )
        : options.kind === 'refresh'
          ? beginFilesWorkspaceRefresh(currentState)
          : beginFilesWorkspaceNavigation(currentState, normalized, {
              historyMode: options.historyMode,
            })
      if (!request) {
        return false
      }

      const controller = new AbortController()
      requestControllersRef.current.get(requestSession.id)?.controller.abort()
      requestControllersRef.current.set(requestSession.id, {
        controller,
        connectionGeneration: requestSession.connection_generation ?? 0,
      })
      updateSession(
        requestSession.id,
        requestSession.current_path || '/',
        () => request.state,
      )
      const cancelRequestState = () => {
        updateExistingSession(
          requestSession.id,
          (latest) => (
            latest.activeRequest?.requestSequence === request.requestSequence
              ? cancelFilesWorkspaceDirectoryRequest(latest)
              : latest
          ),
        )
      }
      try {
        const listing = await gateway.listFileSessionFiles(
          requestSession.id,
          normalized,
          { signal: controller.signal },
        )
        const currentRequest = requestControllersRef.current.get(requestSession.id)
        const currentSession = fileSessionsRef.current.find(
          (session) => session.id === requestSession.id,
        )
        const isCurrentRequest = currentRequest?.controller === controller
        const isCurrentGeneration = (
          currentSession?.status === 'connected'
          && (currentSession.connection_generation ?? 0)
            === (requestSession.connection_generation ?? 0)
          && !closingFileSessionIdsRef.current.has(requestSession.id)
        )
        if (!isCurrentRequest || !isCurrentGeneration) {
          cancelRequestState()
          return false
        }
        updateExistingSession(
          requestSession.id,
          (latest) => completeFilesWorkspaceDirectoryRequest(
            latest,
            request.requestSequence,
            listing,
            Date.now(),
            requestSession.connection_generation ?? 0,
          ),
        )
        if (isActiveFilesWorkspaceDirectoryResult(
          requestSession,
          activeFileSessionIdRef.current,
          currentSession,
        )) {
          clearDirectoryDirty(requestSession.id, normalized)
          onActiveDirectoryCommitted()
          return true
        }
        return false
      } catch (loadError) {
        if (controller.signal.aborted) {
          cancelRequestState()
          return false
        }
        const currentRequest = requestControllersRef.current.get(requestSession.id)
        const currentSession = fileSessionsRef.current.find(
          (session) => session.id === requestSession.id,
        )
        if (
          currentRequest?.controller !== controller
          || currentSession?.status !== 'connected'
          || (currentSession.connection_generation ?? 0)
            !== (requestSession.connection_generation ?? 0)
          || closingFileSessionIdsRef.current.has(requestSession.id)
        ) {
          cancelRequestState()
          return false
        }
        const description = loadError instanceof Error
          ? loadError.message
          : unknownErrorMessage
        updateExistingSession(
          requestSession.id,
          (latest) => failFilesWorkspaceDirectoryRequest(
            latest,
            request.requestSequence,
            description,
          ),
        )
        if (
          !isActiveFilesWorkspaceDirectoryResult(
            requestSession,
            activeFileSessionIdRef.current,
            currentSession,
          )
          || closingFileSessionIdsRef.current.has(requestSession.id)
        ) {
          return false
        }
        options.onError?.(description)
        if (options.quiet) {
          return false
        }
        onDirectoryReadFailed(description)
        return false
      } finally {
        if (
          requestControllersRef.current.get(requestSession.id)?.controller
            === controller
        ) {
          requestControllersRef.current.delete(requestSession.id)
        }
      }
    },
    [
      activeFileSession,
      activeFileSessionIdRef,
      clearDirectoryDirty,
      closingFileSessionIdsRef,
      fileSessionsRef,
      gateway,
      onActiveDirectoryCommitted,
      onDirectoryReadFailed,
      onInvalidPath,
      unknownErrorMessage,
      updateExistingSession,
      updateSession,
      workspaceStatesRef,
    ],
  )

  useEffect(
    () => () => {
      // React 严格模式会模拟一次卸载；必须释放加载标记和请求，让正式挂载重新加载。
      lastAutomaticLoadKeyRef.current = ''
      requestControllersRef.current.forEach((request, fileSessionId) => {
        request.controller.abort()
        updateExistingSession(
          fileSessionId,
          cancelFilesWorkspaceDirectoryRequest,
        )
      })
      requestControllersRef.current.clear()
    },
    [updateExistingSession],
  )

  useEffect(() => {
    if (!activeFileSession) {
      lastAutomaticLoadKeyRef.current = ''
      return undefined
    }
    if (!canStartFilesWorkspaceDirectoryLoad(
      activeFileSession.status,
      activeFileSessionRecovering,
    )) {
      lastAutomaticLoadKeyRef.current = ''
      return undefined
    }
    const loadKey = [
      activeFileSession.id,
      activeFileSession.connection_generation ?? 0,
      activeFileSession.connected_at ?? '',
    ].join(':')
    if (lastAutomaticLoadKeyRef.current === loadKey) {
      return undefined
    }
    const cached = getFilesWorkspaceSessionState(
      workspaceStatesRef.current,
      activeFileSession.id,
      activeFileSession.current_path || '/',
    )
    const cacheDirty = isDirectoryDirty(activeFileSession.id, cached.committedPath)
    const automaticRequest = resolveFilesWorkspaceAutomaticDirectoryRequest(
      cached,
      activeFileSession.current_path || '/',
      Date.now(),
      filesWorkspaceCacheMaxAgeMs,
      cacheDirty,
      activeFileSession.connection_generation ?? 0,
    )
    if (!automaticRequest) {
      lastAutomaticLoadKeyRef.current = loadKey
      return undefined
    }
    const request = automaticRequest.kind === 'initial'
      ? {
          path: automaticRequest.path,
          options: { historyMode: 'replace' as const },
        }
      : {
          path: automaticRequest.path,
          options: { kind: 'refresh' as const, quiet: true },
        }

    // 将首次请求推迟到严格模式的试运行清理之后，避免发送一条必然被取消的重复请求。
    const timer = window.setTimeout(() => {
      const currentSession = fileSessionsRef.current.find(
        (session) => session.id === activeFileSession.id,
      )
      if (
        activeFileSessionIdRef.current !== activeFileSession.id
        || currentSession?.status !== 'connected'
        || (currentSession.connection_generation ?? 0)
          !== (activeFileSession.connection_generation ?? 0)
        || activeFileSessionRecovering
        || closingFileSessionIdsRef.current.has(activeFileSession.id)
        || requestControllersRef.current.has(activeFileSession.id)
      ) {
        return
      }
      lastAutomaticLoadKeyRef.current = loadKey
      void loadDirectory(request.path, request.options)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    activeFileSession,
    activeFileSessionIdRef,
    activeFileSessionRecovering,
    closingFileSessionIdsRef,
    fileSessionsRef,
    isDirectoryDirty,
    loadDirectory,
    workspaceStatesRef,
  ])

  useEffect(() => {
    const fileSessionsById = new Map(fileSessions.map((session) => [session.id, session]))
    requestControllersRef.current.forEach((request, fileSessionId) => {
      const fileSession = fileSessionsById.get(fileSessionId)
      if (
        fileSession?.status === 'connected'
        && (fileSession.connection_generation ?? 0) === request.connectionGeneration
        && !closingFileSessionIds.has(fileSessionId)
      ) {
        return
      }
      request.controller.abort()
      requestControllersRef.current.delete(fileSessionId)
      updateExistingSession(
        fileSessionId,
        cancelFilesWorkspaceDirectoryRequest,
      )
    })
  }, [closingFileSessionIds, fileSessions, updateExistingSession])

  useEffect(() => {
    if (!activeFileSessionId) {
      return
    }
    if (activeFileSessionClosing) {
      requestControllersRef.current.get(activeFileSessionId)?.controller.abort()
      requestControllersRef.current.delete(activeFileSessionId)
      updateActiveSession((current) => setFilesWorkspaceDirectoryStatus(current, 'closing'))
      return
    }
    if (activeFileSessionRecovering) {
      requestControllersRef.current.get(activeFileSessionId)?.controller.abort()
      requestControllersRef.current.delete(activeFileSessionId)
      updateActiveSession((current) => setFilesWorkspaceDirectoryStatus(current, 'recovering'))
      return
    }
    if (activeFileSession?.status === 'failed' || activeFileSession?.status === 'disconnected') {
      requestControllersRef.current.get(activeFileSessionId)?.controller.abort()
      requestControllersRef.current.delete(activeFileSessionId)
      updateActiveSession((current) => setFilesWorkspaceDirectoryStatus(
        current,
        'offline',
        activeFileSession.last_error || activeFileSession.status_message || '',
      ))
      return
    }
    if (activeFileSession?.status === 'connected') {
      updateActiveSession((current) => {
        if (
          current.activeRequest
          || !['offline', 'recovering', 'closing'].includes(current.directoryStatus)
        ) {
          return current
        }
        return {
          ...current,
          directoryStatus: 'idle',
          error: '',
        }
      })
    }
  }, [
    activeFileSession,
    activeFileSessionClosing,
    activeFileSessionId,
    activeFileSessionRecovering,
    updateActiveSession,
  ])

  return { loadDirectory }
}
