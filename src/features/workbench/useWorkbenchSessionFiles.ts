import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type {
  AppData,
  FileSession,
  RemoteFileEntry,
  Session,
  SessionCwdState,
} from '../../types/domain'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath'
import { retireWebSocket } from '../../shared/webSocketLifecycle'
import { fileSortValue, normalizeRemotePath } from '../files/fileUtils'
import {
  resolveFileSessionClosure,
  terminatedFileSessionSnapshot,
  type FileSessionClosureState,
} from '../files/fileSessionRecovery'
import {
  useSessionCwdRequestError,
  useSessionCwdState,
  useSessionCwdTransportState,
  useTerminalCwdRuntime,
} from '../terminal/terminalCwdContext'
import {
  adoptSessionFilesCwdRefreshPending,
  applySessionFilesCwdRefreshDispatch,
  applySessionFilesSyncState,
  beginSessionFilesCwdRefresh,
  beginDirectoryRequest,
  cancelDirectoryRequest,
  cancelDirectoryRequestForFollowRefresh,
  completeDirectoryRequest,
  deriveRejectedSessionFilesSyncState,
  deriveSessionFilesCwdRefreshSuccessState,
  deriveSessionFilesFollowSyncState,
  deriveSessionFilesSyncState,
  finishSessionFilesCwdRefresh,
  failDirectoryRequest,
  getSessionFilesViewState,
  hasSessionFilesCwdRefreshRecovered,
  isSessionFilesCwdRefreshComplete,
  rebaseSessionFilesCwdRefreshAfterRecoverableFailure,
  reconcileSessionFilesCwdPending,
  resolveRecoveredSessionFilesDirectory,
  resolveSessionFilesCwdRetryTarget,
  sessionFilesCwdRefreshTransportDisposition,
  sessionFilesCwdRefreshWatchdogRemaining,
  sessionFilesPendingOperationForFileSession,
  scheduleSessionFilesCwdLocalRetry,
  scheduleSessionFilesCwdRefreshRetry,
  sessionFilesViewStatesReducer,
  shouldPrepareSessionFilesCwdControl,
  shouldRequestInitialSessionFilesDirectory,
  shouldRequestFollowedDirectory,
  suspendSessionFilesDirectory,
  updateMatchingSessionFilesCwdRefresh,
  updateSessionFilesViewState,
  type SessionFilesViewState,
} from './sessionFilesState'
import {
  beginFileSessionRecovery,
  buildSourceSessionContexts,
  cancelSupersededFileSessionRecovery,
  canRetryFileSessionRecovery,
  canCompleteFileSessionRecovery,
  canApplyCreatedFileSession,
  canUseSourceFileSession,
  completeFileSessionRecovery,
  failFileSessionRecovery,
  fileSessionRecoveryMethod,
  idleFileSessionRecoveryState,
  isRecoveredFileSessionReady,
  markFileSessionRecoveryTerminated,
  pruneFileSessionRecoveries,
  reconcileDisconnectedFileSessionRecovery,
  requireFileSessionRecovery,
  resolveFileSessionUpdate,
  resolveSourceFileSession,
  resolveSourceFileSessionWithClosure,
  runSingleFileSessionRecovery,
  selectCurrentFileSessionSnapshot,
  shouldCreateFileSessionAfterReconnect,
  shouldMaintainFileSessionEventStream,
  shouldSilentlyCancelFileSessionRecovery,
  waitForFileSessionRecovery,
  type FileSessionRecoveryState,
} from './workbenchFileSessionLifecycle'

interface FileSessionEventMessage {
  type: string
  session?: FileSession
}

interface FileListScrollPosition {
  path: string
  scrollTop: number
}

type FileSessionRecoveryUpdater = (
  current: FileSessionRecoveryState,
) => FileSessionRecoveryState

interface UseWorkbenchSessionFilesOptions {
  api: TermousApi
  data: AppData
  fileSessionClosures: Readonly<Record<string, FileSessionClosureState>>
  activeSession: Session | null
  enabled: boolean
  closingSessionIds: ReadonlySet<string>
  onConnectFileSession: (
    hostId: string,
    sourceSessionId?: string,
    initialPath?: string,
    replacedFileSessionId?: string,
  ) => Promise<FileSession>
  onReconnectFileSession: (fileSessionId: string) => Promise<FileSession>
  onUpdateFileSession: (fileSession: FileSession) => void
}

export function useWorkbenchSessionFiles({
  api,
  data,
  fileSessionClosures,
  activeSession,
  enabled,
  closingSessionIds,
  onConnectFileSession,
  onReconnectFileSession,
  onUpdateFileSession,
}: UseWorkbenchSessionFilesOptions) {
  const cwdRuntime = useTerminalCwdRuntime()
  const sourceSessionId = activeSession?.kind === 'ssh' ? activeSession.id : null
  const sourceSessionStatus = activeSession?.kind === 'ssh' ? activeSession.status : null
  const sourceSessionEndedAt = activeSession?.kind === 'ssh' ? activeSession.ended_at : undefined
  const sourceHostId = activeSession?.kind === 'ssh' ? activeSession.host_id : null
  const cwdState = useSessionCwdState(sourceSessionId)
  const cwdRequestError = useSessionCwdRequestError(sourceSessionId, 'cwd_change')
  const cwdRefreshError = useSessionCwdRequestError(sourceSessionId, 'cwd_refresh')
  const cwdTransportState = useSessionCwdTransportState(sourceSessionId)
  const [viewStates, dispatchViewStates] = useReducer(sessionFilesViewStatesReducer, {})
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, FileSession>>({})
  const [recoveryStates, setRecoveryStates] = useState<Record<string, FileSessionRecoveryState>>({})
  const mountedRef = useRef(true)
  const closingSessionIdsRef = useRef(closingSessionIds)
  const observedClosingSessionIdsRef = useRef<ReadonlySet<string>>(new Set())
  const sourceSessionContextsRef = useRef(buildSourceSessionContexts(data.sessions))
  const fileSessionsRef = useRef(data.fileSessions)
  const onUpdateFileSessionRef = useRef(onUpdateFileSession)
  const sessionOverridesRef = useRef(sessionOverrides)
  const currentFileSessionsRef = useRef(new Map<string, FileSession>())
  const recoveryStatesRef = useRef(recoveryStates)
  const fileSessionClosuresRef = useRef(fileSessionClosures)
  const recoveryPromisesRef = useRef(new Map<string, Promise<void>>())
  const creatingSessionsRef = useRef(new Set<string>())
  const createFailureSessionIdsRef = useRef(new Set<string>())
  const directoryRequestSequencesRef = useRef(new Map<string, number>())
  const directoryRequestControllersRef = useRef(new Map<string, AbortController>())
  const [cwdRefreshWakeSequence, setCwdRefreshWakeSequence] = useState(0)
  const scrollPositionsRef = useRef(new Map<string, FileListScrollPosition>())
  const observedFileSessionIdsRef = useRef(new Map<string, string>())
  const suspendedFileSessionKeysRef = useRef(new Map<string, string>())
  const listRef = useRef<HTMLDivElement>(null)

  sourceSessionContextsRef.current = buildSourceSessionContexts(data.sessions)
  fileSessionsRef.current = data.fileSessions
  onUpdateFileSessionRef.current = onUpdateFileSession
  sessionOverridesRef.current = sessionOverrides
  recoveryStatesRef.current = recoveryStates
  fileSessionClosuresRef.current = fileSessionClosures
  closingSessionIdsRef.current = closingSessionIds
  const sourceSessionClosing = Boolean(sourceSessionId && closingSessionIds.has(sourceSessionId))
  const sourceSessionAvailable = Boolean(
    sourceSessionId
    && sourceHostId
    && canUseSourceFileSession(
      sourceSessionContextsRef.current,
      sourceSessionId,
      sourceHostId,
      closingSessionIds,
    )
  )

  useEffect(() => {
    const directoryRequestControllers = directoryRequestControllersRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      directoryRequestControllers.forEach((controller) => controller.abort())
      directoryRequestControllers.clear()
    }
  }, [])

  useLayoutEffect(() => {
    const activeIds = new Set(data.sessions.map((session) => session.id))
    dispatchViewStates({ type: 'retain', activeSessionIds: activeIds })
    setSessionOverrides((current) => {
      const entries = Object.entries(current)
      const retained = entries.filter(([sessionId]) => activeIds.has(sessionId))
      const next = retained.length === entries.length ? current : Object.fromEntries(retained)
      sessionOverridesRef.current = next
      return next
    })
    setRecoveryStates((current) => {
      const entries = Object.entries(current)
      const retained = entries.filter(([sessionId]) => activeIds.has(sessionId))
      const next = retained.length === entries.length ? current : Object.fromEntries(retained)
      recoveryStatesRef.current = next
      return next
    })
    pruneFileSessionRecoveries(recoveryPromisesRef.current, activeIds)
    for (const activeSourceSessionId of currentFileSessionsRef.current.keys()) {
      if (!activeIds.has(activeSourceSessionId)) {
        currentFileSessionsRef.current.delete(activeSourceSessionId)
      }
    }
    createFailureSessionIdsRef.current = new Set(
      [...createFailureSessionIdsRef.current].filter((sessionId) => activeIds.has(sessionId)),
    )
    directoryRequestSequencesRef.current = new Map(
      [...directoryRequestSequencesRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    for (const [sessionId, controller] of directoryRequestControllersRef.current) {
      if (!activeIds.has(sessionId)) {
        directoryRequestControllersRef.current.delete(sessionId)
        controller.abort()
      }
    }
    scrollPositionsRef.current = new Map(
      [...scrollPositionsRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    observedFileSessionIdsRef.current = new Map(
      [...observedFileSessionIdsRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    suspendedFileSessionKeysRef.current = new Map(
      [...suspendedFileSessionKeysRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
  }, [data.sessions])

  useLayoutEffect(() => {
    const previouslyClosing = observedClosingSessionIdsRef.current
    for (const closingSessionId of closingSessionIds) {
      if (previouslyClosing.has(closingSessionId)) {
        continue
      }
      const controller = directoryRequestControllersRef.current.get(closingSessionId)
      if (!controller) {
        continue
      }
      directoryRequestControllersRef.current.delete(closingSessionId)
      controller.abort()
      const requestSequence = (directoryRequestSequencesRef.current.get(closingSessionId) ?? 0) + 1
      directoryRequestSequencesRef.current.set(closingSessionId, requestSequence)
      dispatchViewStates({
        type: 'invalidate-directory-request',
        sessionId: closingSessionId,
        requestSequence,
      })
    }
    observedClosingSessionIdsRef.current = new Set(closingSessionIds)
  }, [closingSessionIds])

  const fileSession = useMemo(() => {
    if (!sourceSessionId) {
      return null
    }
    const override = sessionOverrides[sourceSessionId]
    const persisted = data.fileSessions.find((session) => session.source_session_id === sourceSessionId)
    return resolveSourceFileSessionWithClosure(
      sourceSessionAvailable,
      override,
      persisted,
      fileSessionClosures[sourceSessionId],
    )
  }, [data.fileSessions, fileSessionClosures, sessionOverrides, sourceSessionAvailable, sourceSessionId])
  const fileSessionId = fileSession?.id ?? ''
  const fileSessionStatus = fileSession?.status ?? null
  const cwdPendingOperation = sessionFilesPendingOperationForFileSession(
    cwdState,
    fileSessionId,
  )
  const recoveryState = sourceSessionId
    ? recoveryStates[sourceSessionId] ?? idleFileSessionRecoveryState
    : idleFileSessionRecoveryState
  if (sourceSessionId) {
    if (fileSession) {
      const previous = currentFileSessionsRef.current.get(sourceSessionId)
      currentFileSessionsRef.current.set(
        sourceSessionId,
        resolveSourceFileSession(true, previous, fileSession) ?? fileSession,
      )
    } else {
      currentFileSessionsRef.current.delete(sourceSessionId)
    }
  }

  const initialPath = cwdState?.confirmed_path || fileSession?.current_path || '/'
  const viewState = sourceSessionId
    ? getSessionFilesViewState(viewStates, sourceSessionId, initialPath)
    : null
  const listingPath = viewState?.listing?.path
    ? normalizeRemotePath(viewState.listing.path)
    : ''
  const maintainFileSessionEventStream = shouldMaintainFileSessionEventStream(
    sourceSessionStatus,
    sourceSessionEndedAt,
    fileSession?.status ?? null,
    sourceSessionClosing,
    enabled,
  )

  const updateView = useCallback((
    update: Parameters<typeof updateSessionFilesViewState>[2],
    initial = '/',
  ) => {
    if (!sourceSessionId) {
      return
    }
    dispatchViewStates({
      type: 'update',
      sessionId: sourceSessionId,
      update,
      initialPath: initial,
    })
  }, [sourceSessionId])

  useLayoutEffect(() => {
    if (!sourceSessionId || !fileSessionId) {
      return
    }
    const previousFileSessionId = observedFileSessionIdsRef.current.get(sourceSessionId)
    observedFileSessionIdsRef.current.set(sourceSessionId, fileSessionId)
    if (!previousFileSessionId || previousFileSessionId === fileSessionId) {
      return
    }
    if (cwdRequestError?.request_id) {
      cwdRuntime.clearRequestError(
        sourceSessionId,
        'cwd_change',
        cwdRequestError.request_id,
      )
    }
    if (cwdRefreshError?.request_id) {
      cwdRuntime.clearRequestError(
        sourceSessionId,
        'cwd_refresh',
        cwdRefreshError.request_id,
      )
    }
    if (!sourceSessionAvailable || !viewState?.followTerminal) {
      return
    }
    updateView((state) => ({
      ...beginSessionFilesCwdRefresh(state, cwdState, Date.now()),
      lastTerminalSyncPath: '',
      syncStatus: 'preparing',
      syncError: '',
    }), initialPath)
  }, [
    cwdRefreshError?.request_id,
    cwdRequestError?.request_id,
    cwdRuntime,
    cwdState,
    fileSessionId,
    initialPath,
    sourceSessionAvailable,
    sourceSessionId,
    updateView,
    viewState?.followTerminal,
  ])

  useLayoutEffect(() => {
    if (!sourceSessionId || !fileSessionId) {
      return
    }
    if (fileSessionStatus === 'connected') {
      suspendedFileSessionKeysRef.current.delete(sourceSessionId)
      return
    }
    const suspensionKey = `${fileSessionId}:${fileSession?.connection_generation ?? 0}`
    if (suspendedFileSessionKeysRef.current.get(sourceSessionId) === suspensionKey) {
      return
    }
    suspendedFileSessionKeysRef.current.set(sourceSessionId, suspensionKey)
    const controller = directoryRequestControllersRef.current.get(sourceSessionId)
    if (controller) {
      directoryRequestControllersRef.current.delete(sourceSessionId)
      controller.abort()
    }
    const requestSequence = (
      directoryRequestSequencesRef.current.get(sourceSessionId) ?? 0
    ) + 1
    directoryRequestSequencesRef.current.set(sourceSessionId, requestSequence)
    updateView(
      (state) => suspendSessionFilesDirectory(state, requestSequence),
      fileSession?.current_path || '/',
    )
  }, [
    fileSession?.connection_generation,
    fileSession?.current_path,
    fileSessionId,
    fileSessionStatus,
    sourceSessionId,
    updateView,
  ])

  const updateRecoveryState = useCallback((
    requestedSourceSessionId: string,
    update: FileSessionRecoveryUpdater,
  ) => {
    const current = recoveryStatesRef.current[requestedSourceSessionId]
      ?? idleFileSessionRecoveryState
    const next = update(current)
    if (next === current) {
      return current
    }
    const states = {
      ...recoveryStatesRef.current,
      [requestedSourceSessionId]: next,
    }
    recoveryStatesRef.current = states
    setRecoveryStates(states)
    return next
  }, [])

  const updateFileSession = useCallback((
    session: FileSession,
    resetProgress = false,
    allowSessionChange = false,
  ) => {
    if (
      !session.source_session_id
      || !canUseSourceFileSession(
        sourceSessionContextsRef.current,
        session.source_session_id,
        session.host_id,
        closingSessionIdsRef.current,
      )
    ) {
      return null
    }
    const sourceID = session.source_session_id
    const previous = selectCurrentFileSessionSnapshot(
      currentFileSessionsRef.current.get(sourceID),
      sessionOverridesRef.current[sourceID],
      fileSessionsRef.current.find((item) => item.source_session_id === sourceID),
    )
    const result = resolveFileSessionUpdate(
      previous,
      session,
      resetProgress,
      allowSessionChange,
    )
    if (!result.accepted) {
      return result
    }
    const overrides = {
      ...sessionOverridesRef.current,
      [sourceID]: result.session,
    }
    sessionOverridesRef.current = overrides
    currentFileSessionsRef.current.set(sourceID, result.session)
    setSessionOverrides(overrides)
    onUpdateFileSessionRef.current(result.session)
    return result
  }, [])

  const markFileSessionRecoveryRequired = useCallback((
    session: FileSession,
    terminated: boolean,
  ) => {
    const requestedSourceSessionId = session.source_session_id
    if (!requestedSourceSessionId) {
      return
    }
    const current = selectCurrentFileSessionSnapshot(
      currentFileSessionsRef.current.get(requestedSourceSessionId),
      sessionOverridesRef.current[requestedSourceSessionId],
      fileSessionsRef.current.find((item) => item.source_session_id === requestedSourceSessionId),
    )
    if (current && current.id !== session.id) {
      return
    }
    const result = updateFileSession(session)
    if (!result?.accepted) {
      return
    }
    updateRecoveryState(requestedSourceSessionId, (recovery) => (
      requireFileSessionRecovery(recovery, session, terminated)
    ))
  }, [updateFileSession, updateRecoveryState])

  const applyDisconnectedFileSession = useCallback((session: FileSession) => {
    const requestedSourceSessionId = session.source_session_id
    if (!requestedSourceSessionId) {
      return
    }
    const result = updateFileSession(session)
    if (!result?.accepted) {
      return
    }
    updateRecoveryState(requestedSourceSessionId, (current) => (
      reconcileDisconnectedFileSessionRecovery(current, result.session)
    ))
  }, [updateFileSession, updateRecoveryState])

  const markFileSessionMissing = useCallback((
    requestedSourceSessionId: string,
    requestedFileSessionId: string,
  ) => {
    const current = selectCurrentFileSessionSnapshot(
      currentFileSessionsRef.current.get(requestedSourceSessionId),
      sessionOverridesRef.current[requestedSourceSessionId],
      fileSessionsRef.current.find((item) => item.source_session_id === requestedSourceSessionId),
    )
    if (!current || current.id !== requestedFileSessionId) {
      return
    }
    markFileSessionRecoveryRequired({
      ...current,
      status: 'disconnected',
      phase: 'disconnected',
      progress: undefined,
      error_code: 'SFTP_FILE_SESSION_NOT_FOUND',
      retryable: true,
      state_seq: current.state_seq === undefined ? undefined : current.state_seq + 1,
    }, true)
  }, [markFileSessionRecoveryRequired])

  useEffect(() => {
    if (
      !enabled ||
      !sourceSessionAvailable ||
      !sourceSessionId ||
      sourceSessionStatus !== 'connected' ||
      !sourceHostId ||
      fileSession ||
      createFailureSessionIdsRef.current.has(sourceSessionId) ||
      creatingSessionsRef.current.has(sourceSessionId)
    ) {
      return
    }
    const requestedSourceSessionId = sourceSessionId
    const requestedInitialPath = cwdState?.confirmed_path || '/'
    creatingSessionsRef.current.add(requestedSourceSessionId)
    void onConnectFileSession(
      sourceHostId,
      requestedSourceSessionId,
      requestedInitialPath,
    ).then((created) => {
      if (
        !mountedRef.current ||
        !canUseSourceFileSession(
          sourceSessionContextsRef.current,
          requestedSourceSessionId,
          sourceHostId,
          closingSessionIdsRef.current,
        ) ||
        !canApplyCreatedFileSession(
          created,
          sourceSessionContextsRef.current,
          requestedSourceSessionId,
          sourceHostId,
        )
      ) {
        return
      }
      createFailureSessionIdsRef.current.delete(requestedSourceSessionId)
      updateFileSession(created)
    }).catch((error) => {
      if (
        !mountedRef.current ||
        !canUseSourceFileSession(
          sourceSessionContextsRef.current,
          requestedSourceSessionId,
          sourceHostId,
          closingSessionIdsRef.current,
        )
      ) {
        return
      }
      createFailureSessionIdsRef.current.add(requestedSourceSessionId)
      const message = error instanceof Error ? error.message : ''
      updateView({ error: message || 'file_session_create_failed', loading: false }, requestedInitialPath)
    }).finally(() => {
      creatingSessionsRef.current.delete(requestedSourceSessionId)
    })
  }, [
    cwdState?.confirmed_path,
    enabled,
    fileSession,
    sourceHostId,
    sourceSessionAvailable,
    sourceSessionId,
    sourceSessionStatus,
    onConnectFileSession,
    updateFileSession,
    updateView,
  ])

  useLayoutEffect(() => {
    if (
      !enabled
      || !sourceSessionId
      || !sourceHostId
      || !fileSession?.id
      || !maintainFileSessionEventStream
    ) {
      return
    }
    const requestedSourceSessionId = sourceSessionId
    const requestedSourceHostId = sourceHostId
    const sourceAvailable = () => canUseSourceFileSession(
      sourceSessionContextsRef.current,
      requestedSourceSessionId,
      requestedSourceHostId,
      closingSessionIdsRef.current,
    )
    let disposed = false
    let terminalMessageReceived = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined
    const connect = () => {
      if (disposed || !sourceAvailable()) {
        return
      }
      const nextSocket = new WebSocket(api.fileSessionEventsUrl(fileSession.id))
      socket = nextSocket
      nextSocket.addEventListener('message', (event) => {
        if (disposed || socket !== nextSocket) {
          return
        }
        try {
          const message = JSON.parse(String(event.data)) as FileSessionEventMessage
          if (
            sourceAvailable()
            && message.session?.id === fileSession.id
            && message.session.source_session_id === requestedSourceSessionId
            && message.session.host_id === requestedSourceHostId
          ) {
            if (message.type === 'closed') {
              terminalMessageReceived = true
              markFileSessionRecoveryRequired(
                terminatedFileSessionSnapshot(message.session),
                true,
              )
              retireWebSocket(nextSocket)
            } else if (
              message.session.status === 'disconnected'
              || message.session.status === 'failed'
            ) {
              applyDisconnectedFileSession(message.session)
            } else {
              updateFileSession(message.session)
            }
          }
        } catch {
          retireWebSocket(nextSocket)
        }
      })
      nextSocket.addEventListener('error', () => retireWebSocket(nextSocket))
      nextSocket.addEventListener('close', () => {
        if (!disposed && !terminalMessageReceived && sourceAvailable() && socket === nextSocket) {
          socket = undefined
          const scheduleReconnect = () => {
            if (!disposed && sourceAvailable()) {
              reconnectTimer = window.setTimeout(connect, 1200)
            }
          }
          void api.getFileSession(fileSession.id).then((snapshot) => {
            if (!disposed && sourceAvailable()) {
              updateFileSession(snapshot)
              scheduleReconnect()
            }
          }).catch((error) => {
            if (
              !disposed
              && sourceAvailable()
              && shouldCreateFileSessionAfterReconnect(error)
            ) {
              markFileSessionMissing(requestedSourceSessionId, fileSession.id)
              return
            }
            scheduleReconnect()
          })
        }
      })
    }
    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      if (socket) {
        retireWebSocket(socket)
      }
    }
  }, [api, applyDisconnectedFileSession, enabled, fileSession?.id, maintainFileSessionEventStream, markFileSessionMissing, markFileSessionRecoveryRequired, sourceHostId, sourceSessionId, updateFileSession])

  useEffect(() => {
    if (
      !sourceSessionAvailable ||
      !sourceSessionId ||
      !sourceHostId ||
      !fileSession ||
      fileSession.status === 'connected' ||
      fileSession.status === 'disconnected' ||
      fileSession.status === 'failed'
    ) {
      return
    }
    const requestedSourceSessionId = sourceSessionId
    const requestedSourceHostId = sourceHostId
    const sourceAvailable = () => canUseSourceFileSession(
      sourceSessionContextsRef.current,
      requestedSourceSessionId,
      requestedSourceHostId,
      closingSessionIdsRef.current,
    )
    let disposed = false
    const refreshSession = async () => {
      if (disposed || !sourceAvailable()) {
        return
      }
      try {
        const next = await api.getFileSession(fileSession.id)
        if (
          mountedRef.current
          && sourceAvailable()
          && next.id === fileSession.id
          && next.source_session_id === requestedSourceSessionId
          && next.host_id === requestedSourceHostId
        ) {
          updateFileSession(next)
        }
      } catch (error) {
        if (
          mountedRef.current
          && sourceAvailable()
          && shouldCreateFileSessionAfterReconnect(error)
        ) {
          markFileSessionMissing(requestedSourceSessionId, fileSession.id)
        }
      }
    }
    const timer = window.setInterval(() => void refreshSession(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [api, fileSession, markFileSessionMissing, sourceHostId, sourceSessionAvailable, sourceSessionId, updateFileSession])

  useEffect(() => {
    if (!sourceSessionId || !fileSession) {
      return
    }
    if (fileSession.status !== 'disconnected' && fileSession.status !== 'failed') {
      if (
        fileSession.status === 'connected'
        && recoveryState.phase === 'required'
      ) {
        updateRecoveryState(sourceSessionId, completeFileSessionRecovery)
      }
      return
    }
    updateRecoveryState(sourceSessionId, (current) => (
      reconcileDisconnectedFileSessionRecovery(current, fileSession)
    ))
  }, [fileSession, recoveryState.phase, sourceSessionId, updateRecoveryState])

  const loadDirectory = useCallback(async (targetPath: string) => {
    if (
      !sourceSessionId
      || !sourceHostId
      || !canUseSourceFileSession(
        sourceSessionContextsRef.current,
        sourceSessionId,
        sourceHostId,
        closingSessionIdsRef.current,
      )
      || !fileSessionId
      || fileSessionStatus !== 'connected'
    ) {
      return false
    }
    const normalized = normalizeRemotePosixPath(targetPath)
    if (!normalized) {
      updateView({
        loading: false,
        error: 'invalid_path',
        syncStatus: 'invalid_path',
      })
      return false
    }
    const sequence = (directoryRequestSequencesRef.current.get(sourceSessionId) ?? 0) + 1
    directoryRequestSequencesRef.current.set(sourceSessionId, sequence)
    const controller = new AbortController()
    const previousController = directoryRequestControllersRef.current.get(sourceSessionId)
    directoryRequestControllersRef.current.set(sourceSessionId, controller)
    previousController?.abort()
    dispatchViewStates({
      type: 'update',
      sessionId: sourceSessionId,
      initialPath: normalized,
      update: (currentView) => beginDirectoryRequest(currentView, normalized, sequence).state,
    })
    try {
      const listing = await api.listFileSessionFiles(fileSessionId, normalized, {
        signal: controller.signal,
      })
      if (
        directoryRequestControllersRef.current.get(sourceSessionId) !== controller
        || !canUseSourceFileSession(
          sourceSessionContextsRef.current,
          sourceSessionId,
          sourceHostId,
          closingSessionIdsRef.current,
        )
      ) {
        return false
      }
      dispatchViewStates({
        type: 'update',
        sessionId: sourceSessionId,
        initialPath: normalized,
        update: (state) => completeDirectoryRequest(state, sequence, listing),
      })
      return true
    } catch (error) {
      if (directoryRequestControllersRef.current.get(sourceSessionId) !== controller) {
        return false
      }
      const message = error instanceof Error ? error.message : ''
      dispatchViewStates({
        type: 'update',
        sessionId: sourceSessionId,
        initialPath: normalized,
        update: (state) => failDirectoryRequest(state, sequence, message, normalized),
      })
      return false
    } finally {
      if (directoryRequestControllersRef.current.get(sourceSessionId) === controller) {
        directoryRequestControllersRef.current.delete(sourceSessionId)
      }
    }
  }, [api, fileSessionId, fileSessionStatus, sourceHostId, sourceSessionId, updateView])

  useEffect(() => {
    if (
      !sourceSessionId
      || !fileSession
      || !isRecoveredFileSessionReady(recoveryState, fileSession)
    ) {
      return
    }
    const transaction = recoveryState.transaction
    const expectedSessionId = fileSession.id
    const expectedConnectionGeneration = fileSession.connection_generation
    const recoveredTerminalPath = isCwdObservationReady(cwdState)
      ? cwdState?.confirmed_path ?? ''
      : ''
    const refreshedPath = viewState
      ? resolveRecoveredSessionFilesDirectory(
          viewState,
          fileSession.current_path || '/',
          recoveredTerminalPath,
        )
      : fileSession.current_path || recoveredTerminalPath || '/'
    let completed = false
    updateRecoveryState(sourceSessionId, (current) => {
      if (!canCompleteFileSessionRecovery(
        current,
        transaction,
        expectedSessionId,
        expectedConnectionGeneration,
        currentFileSessionsRef.current.get(sourceSessionId),
      )) {
        return current
      }
      completed = true
      return completeFileSessionRecovery(current)
    })
    if (!completed) {
      return
    }
    if (
      viewState?.followTerminal
      && !normalizeRemotePosixPath(recoveredTerminalPath)
    ) {
      updateView((state) => ({
        ...beginSessionFilesCwdRefresh(state, cwdState, Date.now()),
        syncStatus: 'preparing',
        syncError: '',
      }), initialPath)
      return
    }
    updateView({ error: '', loading: false }, refreshedPath)
    void loadDirectory(refreshedPath)
  }, [cwdState, fileSession, initialPath, loadDirectory, recoveryState, sourceSessionId, updateRecoveryState, updateView, viewState])

  useEffect(() => {
    if (
      !enabled ||
      !sourceSessionAvailable ||
      !sourceSessionId ||
      fileSession?.status !== 'connected' ||
      directoryRequestControllersRef.current.has(sourceSessionId) ||
      !viewState ||
      !shouldRequestInitialSessionFilesDirectory(viewState)
    ) {
      return
    }
    // 延迟到下一任务，允许 StrictMode 的试运行清理先取消重复首读。
    const timer = window.setTimeout(() => {
      if (!directoryRequestControllersRef.current.has(sourceSessionId)) {
        void loadDirectory(viewState?.path || initialPath)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [enabled, fileSession?.status, initialPath, loadDirectory, sourceSessionAvailable, sourceSessionId, viewState])

  useEffect(() => {
    if (
      !enabled ||
      !sourceSessionAvailable ||
      !viewState?.followTerminal ||
      !cwdState?.confirmed_path ||
      fileSessionStatus !== 'connected' ||
      !isCwdObservationReady(cwdState)
    ) {
      return
    }
    const confirmedPath = normalizeRemotePath(cwdState.confirmed_path)
    const pendingPath = viewState.pendingTerminalPath || (
      cwdPendingOperation?.status === 'failed'
        ? ''
        : cwdPendingOperation?.path ?? ''
    )
    if (!shouldRequestFollowedDirectory(viewState, confirmedPath, pendingPath)) {
      return
    }
    const timer = window.setTimeout(() => {
      if (
        !sourceSessionId
      ) {
        return
      }
      void loadDirectory(confirmedPath)
    }, 140)
    return () => window.clearTimeout(timer)
  }, [
    cwdState,
    cwdState?.confirmed_path,
    cwdPendingOperation?.path,
    cwdPendingOperation?.status,
    enabled,
    fileSessionStatus,
    loadDirectory,
    sourceSessionId,
    sourceSessionAvailable,
    viewState?.pendingTerminalPath,
    viewState,
  ])

  useEffect(() => {
    if (
      !sourceSessionAvailable
      || !enabled
      || !viewState?.followTerminal
      || !cwdState
      || fileSessionStatus !== 'connected'
    ) {
      return
    }
    const refreshPending = viewState.cwdRefresh.phase === 'waiting'
      || viewState.cwdRefresh.phase === 'pending'
    const refreshConfirmed = viewState.cwdRefresh.phase === 'pending'
      && isSessionFilesCwdRefreshComplete(cwdState, {
        requestId: viewState.cwdRefresh.requestId,
        baseRefreshSequence: viewState.cwdRefresh.baseRefreshSequence,
        baseConfirmedPath: viewState.cwdRefresh.baseConfirmedPath,
      })
    const derived = deriveSessionFilesFollowSyncState(
      cwdState,
      cwdRequestError,
      viewState.cwdRefresh.error,
      refreshPending,
      refreshConfirmed,
      sessionFilesCwdRefreshTransportDisposition(cwdTransportState),
      fileSessionId,
    )
    const confirmedPath = cwdState.confirmed_path
      ? normalizeRemotePath(cwdState.confirmed_path)
      : ''
    updateView(
      (state) => {
        const next = applySessionFilesSyncState(
          state,
          derived.status,
          derived.error,
          state.pendingTerminalPath ? '' : confirmedPath,
        )
        const terminalSyncCompleted = Boolean(
          state.lastTerminalSyncPath
          && confirmedPath
          && normalizeRemotePath(state.lastTerminalSyncPath) === confirmedPath
          && !cwdPendingOperation
        )
        return terminalSyncCompleted
          ? { ...next, lastTerminalSyncPath: '' }
          : next
      },
      initialPath,
    )
  }, [
    cwdState,
    cwdRequestError,
    cwdTransportState,
    enabled,
    fileSessionId,
    fileSessionStatus,
    initialPath,
    sourceSessionId,
    sourceSessionAvailable,
    updateView,
    cwdPendingOperation,
    viewState?.cwdRefresh,
    viewState?.followTerminal,
  ])

  useEffect(() => {
    if (
      !sourceSessionId
      || !sourceSessionAvailable
      || !enabled
      || !viewState?.followTerminal
      || viewState.cwdRefresh.phase === 'idle'
    ) {
      return
    }
    const refresh = viewState.cwdRefresh
    const now = Date.now()
    const updateMatchingRefresh = (
      update: (state: SessionFilesViewState) => SessionFilesViewState,
    ) => {
      updateView(
        (state) => updateMatchingSessionFilesCwdRefresh(
          state,
          refresh,
          update,
        ),
        initialPath,
      )
    }
    const finishRefresh = (
      error = '',
      statusOverride?: 'unsupported' | 'reconnect-required',
    ) => {
      const successState = deriveSessionFilesCwdRefreshSuccessState(
        cwdState,
        fileSessionId,
      )
      const confirmedPath = cwdState?.confirmed_path
        ? normalizeRemotePath(cwdState.confirmed_path)
        : ''
      updateMatchingRefresh((state) => applySessionFilesSyncState(
        finishSessionFilesCwdRefresh(state, error),
        statusOverride ?? (error ? 'failed' : successState.status),
        error || successState.error,
        state.pendingTerminalPath ? '' : confirmedPath,
      ))
    }
    const rebaseRefresh = (errorCode: string) => {
      const rebased = rebaseSessionFilesCwdRefreshAfterRecoverableFailure(
        refresh,
        cwdState,
        now,
        errorCode,
      )
      if (!rebased) {
        return false
      }
      if (refresh.requestId) {
        cwdRuntime.clearRequestError(sourceSessionId, 'cwd_refresh', refresh.requestId)
      }
      updateMatchingRefresh((state) => {
        return {
          ...state,
          cwdRefresh: rebased,
          syncError: '',
        }
      })
      return true
    }

    if (refresh.phase === 'failed') {
      if (hasSessionFilesCwdRefreshRecovered(refresh, cwdState)) {
        finishRefresh()
      } else if (
        cwdState
        && (
          cwdState.source_generation > refresh.baseSourceGeneration
          || cwdState.refresh_seq > refresh.baseRefreshSequence
        )
        && !normalizeRemotePosixPath(cwdState.confirmed_path ?? '')
      ) {
        updateMatchingRefresh((state) => ({
          ...beginSessionFilesCwdRefresh(state, cwdState, now),
          syncStatus: 'preparing',
          syncError: '',
        }))
      }
      return
    }

    if (
      refresh.requestId
      && cwdState
      && cwdState.source_generation !== refresh.baseSourceGeneration
    ) {
      if (!rebaseRefresh('CWD_STALE')) {
        finishRefresh('CWD_STALE')
      }
      return
    }

    if (
      refresh.requestId
      && cwdState?.refresh_request_id === refresh.requestId
      && cwdState.refresh_status !== undefined
      && cwdState.refresh_status !== 'pending'
    ) {
      if (cwdState.refresh_status === 'succeeded') {
        finishRefresh()
      } else {
        const errorCode = cwdState.refresh_error_code
          || (cwdState.refresh_status === 'canceled' ? 'CWD_STALE' : 'CWD_REMOTE_FAILED')
        if (!rebaseRefresh(errorCode)) {
          finishRefresh(cwdState.refresh_error || errorCode)
        }
      }
      return
    }

    if (cwdState?.control_status === 'reconnect_required') {
      finishRefresh(
        cwdState.capability_cause || 'CWD_RECONNECT_REQUIRED',
        'reconnect-required',
      )
      return
    }
    if (
      cwdState?.control_status === 'unsupported'
      || (cwdState?.control_status === undefined && cwdState?.capability === 'unsupported')
    ) {
      finishRefresh(cwdState.capability_cause || 'CWD_UNSUPPORTED', 'unsupported')
      return
    }

    if (
      refresh.requestId
      && isSessionFilesCwdRefreshComplete(cwdState, {
        requestId: cwdState?.refresh_request_id ? refresh.requestId : undefined,
        baseRefreshSequence: refresh.baseRefreshSequence,
        baseConfirmedPath: refresh.baseConfirmedPath,
      })
    ) {
      finishRefresh()
      return
    }

    if (cwdRefreshError?.request_id === refresh.requestId && refresh.requestId) {
      if (rebaseRefresh(cwdRefreshError.code)) {
        return
      }
      if (cwdRefreshError.retryable) {
        const retry = scheduleSessionFilesCwdRefreshRetry(refresh, Date.now())
        if (retry) {
          cwdRuntime.clearRequestError(sourceSessionId, 'cwd_refresh', refresh.requestId)
          updateMatchingRefresh((state) => ({
            ...state,
            cwdRefresh: retry,
          }))
          return
        }
      }
      finishRefresh(cwdRefreshError.message || cwdRefreshError.code)
      return
    }

    const reconciledPending = reconcileSessionFilesCwdPending(
      refresh,
      cwdState,
      viewState.followTerminal,
      now,
    )
    if (reconciledPending !== refresh) {
      cwdRuntime.clearRequestError(sourceSessionId, 'cwd_refresh', refresh.requestId)
      updateMatchingRefresh((state) => ({
        ...state,
        cwdRefresh: reconcileSessionFilesCwdPending(
          state.cwdRefresh,
          cwdState,
          state.followTerminal,
          now,
        ),
      }))
      return
    }

    const scheduleLocalWake = () => {
      updateMatchingRefresh((state) => {
        const current = state.cwdRefresh
        if (
          !state.followTerminal
        ) {
          return state
        }
        return {
          ...state,
          cwdRefresh: scheduleSessionFilesCwdLocalRetry(current, Date.now()),
        }
      })
    }
    const watchdogRemaining = sessionFilesCwdRefreshWatchdogRemaining(
      refresh.deadlineAt,
      now,
    )
    if (watchdogRemaining <= 0) {
      finishRefresh('CWD_TIMEOUT')
      return
    }
    const retryRemaining = refresh.retryAt > now ? refresh.retryAt - now : 0
    const wakeTimer = window.setTimeout(
      () => setCwdRefreshWakeSequence((current) => current + 1),
      retryRemaining > 0
        ? Math.min(watchdogRemaining, retryRemaining)
        : watchdogRemaining,
    )

    if (
      !refresh.requestId
      && cwdState?.refresh_status === 'pending'
      && cwdState.refresh_request_id
    ) {
      updateMatchingRefresh((state) => ({
        ...state,
        cwdRefresh: adoptSessionFilesCwdRefreshPending(state.cwdRefresh, cwdState),
      }))
      return () => window.clearTimeout(wakeTimer)
    }

    const transportDisposition = sessionFilesCwdRefreshTransportDisposition(cwdTransportState)
    if (transportDisposition === 'failed') {
      finishRefresh('cwd_refresh_transport_unavailable')
      return () => window.clearTimeout(wakeTimer)
    }
    if (
      transportDisposition !== 'ready'
      || sourceSessionStatus !== 'connected'
    ) {
      return () => window.clearTimeout(wakeTimer)
    }

    if (refresh.retryAt > now) {
      return () => window.clearTimeout(wakeTimer)
    }
    if (!canAttemptCwdRefresh(cwdState)) {
      scheduleLocalWake()
      return () => window.clearTimeout(wakeTimer)
    }

    if (refresh.requestId) {
      if (refresh.retryAt <= 0) {
        return () => window.clearTimeout(wakeTimer)
      }
      const retryResult = cwdRuntime.retryRefreshDirectory(sourceSessionId, refresh.requestId)
      if (retryResult.status === 'queued') {
        updateMatchingRefresh((state) => ({
          ...state,
          cwdRefresh: applySessionFilesCwdRefreshDispatch(state.cwdRefresh, retryResult),
        }))
      } else {
        scheduleLocalWake()
      }
      return () => window.clearTimeout(wakeTimer)
    }

    const result = cwdRuntime.refreshDirectory(sourceSessionId)
    if (result.status === 'queued') {
      updateMatchingRefresh((state) => ({
        ...state,
        cwdRefresh: applySessionFilesCwdRefreshDispatch(state.cwdRefresh, result),
      }))
    } else {
      scheduleLocalWake()
    }
    return () => window.clearTimeout(wakeTimer)
  }, [
    cwdRuntime,
    cwdState,
    cwdRefreshError,
    cwdRefreshWakeSequence,
    cwdRequestError,
    cwdTransportState,
    enabled,
    fileSessionId,
    initialPath,
    sourceSessionId,
    sourceSessionStatus,
    sourceSessionAvailable,
    updateView,
    viewState?.cwdRefresh,
    viewState?.followTerminal,
  ])

  useLayoutEffect(() => {
    if (!sourceSessionId || !listingPath || !listRef.current) {
      return
    }
    const saved = scrollPositionsRef.current.get(sourceSessionId)
    const scrollTop = saved?.path === listingPath ? saved.scrollTop : 0
    listRef.current.scrollTop = scrollTop
    scrollPositionsRef.current.set(sourceSessionId, { path: listingPath, scrollTop })
  }, [listingPath, sourceSessionId])

  useEffect(() => {
    if (
      !enabled
      || !sourceSessionAvailable
      || !sourceSessionId
      || !fileSessionId
      || fileSessionStatus !== 'connected'
      || !viewState?.followTerminal
      || !viewState.pendingTerminalPath
      || viewState.cwdRefresh.phase !== 'idle'
      || !isCwdControlReady(cwdState)
    ) {
      return
    }
    const targetPath = viewState.pendingTerminalPath
    const result = cwdRuntime.requestDirectoryChange(sourceSessionId, fileSessionId, targetPath)
    if (result.status === 'not_ready') {
      return
    }
    if (result.status === 'queued') {
      updateView({
        pendingTerminalPath: '',
        lastTerminalSyncPath: targetPath,
        syncStatus: 'queued',
        syncError: '',
      }, targetPath)
      return
    }
    if (result.status === 'already_current') {
      updateView({
        pendingTerminalPath: '',
        lastTerminalSyncPath: '',
        syncStatus: '',
        syncError: '',
      }, targetPath)
      return
    }
    const rejected = deriveRejectedSessionFilesSyncState(
      result.status,
      cwdState,
      result.status === 'unsupported' ? result.reason : '',
    )
    updateView({
      pendingTerminalPath: '',
      syncStatus: rejected.status,
      syncError: rejected.error,
    }, targetPath)
  }, [
    cwdRuntime,
    cwdState,
    cwdTransportState,
    enabled,
    fileSessionId,
    fileSessionStatus,
    sourceSessionId,
    sourceSessionAvailable,
    updateView,
    viewState?.cwdRefresh.phase,
    viewState?.followTerminal,
    viewState?.pendingTerminalPath,
  ])

  const navigateDirectory = useCallback(async (targetPath: string) => {
    if (
      !sourceSessionId
      || !sourceHostId
      || !canUseSourceFileSession(
        sourceSessionContextsRef.current,
        sourceSessionId,
        sourceHostId,
        closingSessionIdsRef.current,
      )
      || !fileSessionId
      || fileSessionStatus !== 'connected'
      || !viewState
    ) {
      return false
    }
    const normalized = normalizeRemotePosixPath(targetPath)
    if (!normalized) {
      updateView({
        syncStatus: 'invalid_path',
        syncError: '',
      })
      return false
    }
    if (!viewState.followTerminal) {
      return loadDirectory(normalized)
    }
    const refreshInFlight = viewState.cwdRefresh.phase === 'waiting'
      || viewState.cwdRefresh.phase === 'pending'
    if (refreshInFlight || !isCwdControlReady(cwdState)) {
      const pendingState = deriveSessionFilesFollowSyncState(
        cwdState,
        cwdRequestError,
        '',
        true,
        false,
        sessionFilesCwdRefreshTransportDisposition(cwdTransportState),
        fileSessionId,
      )
      updateView((state) => {
        const pending = {
          ...state,
          pendingTerminalPath: normalized,
          lastTerminalSyncPath: normalized,
          syncStatus: pendingState.status,
          syncError: pendingState.error,
        }
        if (
          state.cwdRefresh.phase !== 'waiting'
          && state.cwdRefresh.phase !== 'pending'
          && shouldPrepareSessionFilesCwdControl(cwdState)
        ) {
          return beginSessionFilesCwdRefresh(pending, cwdState, Date.now())
        }
        return pending
      }, normalized)
      return loadDirectory(normalized)
    }
    const result = cwdRuntime.requestDirectoryChange(sourceSessionId, fileSessionId, normalized)
    if (result.status === 'already_current') {
      updateView((state) => ({
        ...finishSessionFilesCwdRefresh(state),
        lastTerminalSyncPath: '',
        syncStatus: '',
        syncError: '',
      }), normalized)
      return loadDirectory(normalized)
    }
    if (result.status !== 'queued') {
      if (result.status === 'not_ready') {
        updateView((state) => beginSessionFilesCwdRefresh({
          ...state,
          pendingTerminalPath: normalized,
          lastTerminalSyncPath: normalized,
          syncStatus: 'preparing',
          syncError: '',
        }, cwdState, Date.now()), normalized)
        return loadDirectory(normalized)
      }
      const rejected = deriveRejectedSessionFilesSyncState(
        result.status,
        cwdState,
        result.status === 'unsupported' ? result.reason : '',
      )
      updateView({
        syncStatus: rejected.status,
        syncError: rejected.error,
      }, normalized)
      return false
    }
    updateView((state) => ({
      ...finishSessionFilesCwdRefresh(state),
      path: normalized,
      pendingTerminalPath: '',
      lastTerminalSyncPath: normalized,
      error: '',
      syncStatus: 'queued',
      syncError: '',
    }), normalized)
    return true
  }, [cwdRequestError, cwdRuntime, cwdState, cwdTransportState, fileSessionId, fileSessionStatus, loadDirectory, sourceHostId, sourceSessionId, updateView, viewState])

  const setFollowTerminal = useCallback((followTerminal: boolean) => {
    const startsRefresh = followTerminal && !viewState?.followTerminal
    let invalidatedRequestSequence = 0
    if (startsRefresh && sourceSessionId) {
      const controller = directoryRequestControllersRef.current.get(sourceSessionId)
      directoryRequestControllersRef.current.delete(sourceSessionId)
      controller?.abort()
      invalidatedRequestSequence = Math.max(
        directoryRequestSequencesRef.current.get(sourceSessionId) ?? 0,
        viewState?.requestSequence ?? 0,
      ) + 1
      directoryRequestSequencesRef.current.set(sourceSessionId, invalidatedRequestSequence)
    }
    const derived = startsRefresh
      ? deriveSessionFilesFollowSyncState(
          cwdState,
          cwdRequestError,
          '',
          true,
          false,
          sessionFilesCwdRefreshTransportDisposition(cwdTransportState),
          fileSessionId,
        )
      : followTerminal
        ? deriveSessionFilesSyncState(cwdState, cwdRequestError, fileSessionId)
        : { status: '' as const, error: '' }
    if (!followTerminal && sourceSessionId && viewState?.listing) {
      const controller = directoryRequestControllersRef.current.get(sourceSessionId)
      if (controller) {
        directoryRequestControllersRef.current.delete(sourceSessionId)
        controller.abort()
      }
    }
    updateView((state) => {
      const next = startsRefresh
        ? cancelDirectoryRequestForFollowRefresh(state, invalidatedRequestSequence)
        : followTerminal
          ? state
          : cancelDirectoryRequest(state)
      const withRefresh = startsRefresh
        ? beginSessionFilesCwdRefresh(next, cwdState, Date.now())
        : followTerminal
          ? next
          : {
              ...finishSessionFilesCwdRefresh(next),
              followTerminal: false,
              followGeneration: next.followGeneration + 1,
              pendingTerminalPath: '',
              lastTerminalSyncPath: '',
            }
      return {
        ...withRefresh,
        followTerminal,
        error: '',
        failedRequestPath: '',
        syncStatus: derived.status,
        syncError: derived.error,
      }
    }, initialPath)
  }, [cwdRequestError, cwdState, cwdTransportState, fileSessionId, initialPath, sourceSessionId, updateView, viewState?.followTerminal, viewState?.listing, viewState?.requestSequence])

  const retryCwdSync = useCallback(() => {
    if (
      !sourceSessionId
      || !sourceSessionAvailable
      || !enabled
      || fileSessionStatus !== 'connected'
      || !viewState?.followTerminal
    ) {
      return
    }
    const retryTargetPath = resolveSessionFilesCwdRetryTarget(
      cwdState,
      fileSessionId,
      cwdRequestError,
      viewState.lastTerminalSyncPath,
    )
    if (cwdRequestError?.request_id) {
      cwdRuntime.clearRequestError(
        sourceSessionId,
        'cwd_change',
        cwdRequestError.request_id,
      )
    }
    if (cwdRefreshError?.request_id) {
      cwdRuntime.clearRequestError(
        sourceSessionId,
        'cwd_refresh',
        cwdRefreshError.request_id,
      )
    }
    if (retryTargetPath) {
      void navigateDirectory(retryTargetPath)
      return
    }
    updateView((state) => {
      if (!state.followTerminal) {
        return state
      }
      return {
        ...beginSessionFilesCwdRefresh(state, cwdState, Date.now()),
        lastTerminalSyncPath: '',
        syncStatus: 'preparing',
        syncError: '',
      }
    }, initialPath)
  }, [
    cwdRefreshError?.request_id,
    cwdRequestError,
    cwdRuntime,
    cwdState,
    enabled,
    fileSessionId,
    fileSessionStatus,
    initialPath,
    navigateDirectory,
    sourceSessionAvailable,
    sourceSessionId,
    updateView,
    viewState?.followTerminal,
    viewState?.lastTerminalSyncPath,
  ])

  const retryDirectory = useCallback(() => loadDirectory(
    viewState?.failedRequestPath || viewState?.path || initialPath,
  ), [initialPath, loadDirectory, viewState?.failedRequestPath, viewState?.path])

  const setSelectedPaths = useCallback((selectedPaths: string[]) => {
    updateView({ selectedPaths }, initialPath)
  }, [initialPath, updateView])

  const recordScroll = useCallback(() => {
    if (sourceSessionId && listingPath && listRef.current) {
      scrollPositionsRef.current.set(sourceSessionId, {
        path: listingPath,
        scrollTop: listRef.current.scrollTop,
      })
    }
  }, [listingPath, sourceSessionId])

  const reconnect = useCallback(() => {
    if (
      !sourceSessionId
      || !sourceHostId
      || !canUseSourceFileSession(
        sourceSessionContextsRef.current,
        sourceSessionId,
        sourceHostId,
        closingSessionIdsRef.current,
      )
    ) {
      return Promise.resolve()
    }
    const requestedSourceSessionId = sourceSessionId
    const requestedSourceHostId = sourceHostId
    const requestedFileSession = fileSession
    return runSingleFileSessionRecovery(
      recoveryPromisesRef.current,
      requestedSourceSessionId,
      async () => {
        const currentRecovery = recoveryStatesRef.current[requestedSourceSessionId]
          ?? idleFileSessionRecoveryState
        const terminated = Boolean(
          requestedFileSession
          && currentRecovery.sessionId === requestedFileSession.id
          && currentRecovery.terminated,
        )
        const started = updateRecoveryState(requestedSourceSessionId, (current) => (
          beginFileSessionRecovery(current, requestedFileSession?.id ?? '', terminated)
        ))
        updateView({ error: '', loading: false }, initialPath)
        try {
          let next: FileSession
          let replacesSession = fileSessionRecoveryMethod(requestedFileSession, started) === 'create'
          if (!replacesSession && requestedFileSession) {
            try {
              next = await onReconnectFileSession(requestedFileSession.id)
            } catch (error) {
              if (!shouldCreateFileSessionAfterReconnect(error)) {
                throw error
              }
              replacesSession = true
              updateRecoveryState(requestedSourceSessionId, (current) => (
                current.transaction === started.transaction
                  ? markFileSessionRecoveryTerminated(current, requestedFileSession.id)
                  : current
              ))
              next = await onConnectFileSession(
                requestedSourceHostId,
                requestedSourceSessionId,
                viewState?.listing?.path || requestedFileSession.current_path || initialPath,
                requestedFileSession.id,
              )
            }
          } else {
            next = await onConnectFileSession(
              requestedSourceHostId,
              requestedSourceSessionId,
              viewState?.listing?.path || requestedFileSession?.current_path || initialPath,
              requestedFileSession?.id,
            )
          }
          if (
            !mountedRef.current
            || !canUseSourceFileSession(
              sourceSessionContextsRef.current,
              requestedSourceSessionId,
              requestedSourceHostId,
              closingSessionIdsRef.current,
            )
            || !canApplyCreatedFileSession(
              next,
              sourceSessionContextsRef.current,
              requestedSourceSessionId,
              requestedSourceHostId,
            )
            || recoveryStatesRef.current[requestedSourceSessionId]?.transaction !== started.transaction
          ) {
            return
          }
          createFailureSessionIdsRef.current.delete(requestedSourceSessionId)
          const applied = updateFileSession(next, true, replacesSession)
          if (!applied || applied.session.id !== next.id) {
            return
          }
          updateRecoveryState(requestedSourceSessionId, (current) => (
            current.transaction === started.transaction
              ? waitForFileSessionRecovery(current, applied.session)
              : current
          ))
        } catch (error) {
          if (shouldSilentlyCancelFileSessionRecovery(error)) {
            const closure = fileSessionClosuresRef.current[requestedSourceSessionId]
            const authoritative = resolveFileSessionClosure(
              selectCurrentFileSessionSnapshot(
                currentFileSessionsRef.current.get(requestedSourceSessionId),
                sessionOverridesRef.current[requestedSourceSessionId],
                fileSessionsRef.current.find(
                  (item) => item.source_session_id === requestedSourceSessionId,
                ),
              ) ?? null,
              closure,
            )
            updateRecoveryState(requestedSourceSessionId, (current) => (
              cancelSupersededFileSessionRecovery(
                current,
                started.transaction,
                authoritative,
                closure?.phase === 'closed',
              )
            ))
            return
          }
          if (!canUseSourceFileSession(
            sourceSessionContextsRef.current,
            requestedSourceSessionId,
            requestedSourceHostId,
            closingSessionIdsRef.current,
          )) {
            return
          }
          updateRecoveryState(requestedSourceSessionId, (current) => (
            current.transaction === started.transaction
              ? failFileSessionRecovery(current, fileSessionRecoveryErrorCode(error))
              : current
          ))
        }
      },
    )
  }, [fileSession, initialPath, onConnectFileSession, onReconnectFileSession, sourceHostId, sourceSessionId, updateFileSession, updateRecoveryState, updateView, viewState?.listing?.path])

  const entries = useMemo(
    () => [...(viewState?.listing?.entries ?? [])].sort((left, right) => {
      const sortValue = fileSortValue(left).localeCompare(fileSortValue(right))
      if (sortValue !== 0) {
        return sortValue
      }
      if (left.name !== right.name) {
        return left.name < right.name ? -1 : 1
      }
      return left.path.localeCompare(right.path)
    }),
    [viewState?.listing?.entries],
  )

  return {
    sourceSessionId,
    fileSession,
    viewState,
    cwdState,
    cwdPendingOperation,
    listRef,
    entries,
    connected: fileSession?.status === 'connected',
    recoveryState,
    recoveryBusy: recoveryState.phase === 'requesting' || recoveryState.phase === 'waiting_ready',
    recoveryCanRetry: canRetryFileSessionRecovery(
      fileSession,
      recoveryState,
      Boolean(viewState?.error),
    ),
    loadDirectory,
    retryDirectory,
    retryCwdSync,
    navigateDirectory,
    reconnect,
    setFollowTerminal,
    setSelectedPaths,
    recordScroll,
    updateView,
    updateFileSession,
  }
}

export function findEntry(entries: RemoteFileEntry[], path: string) {
  return entries.find((entry) => entry.path === path) ?? null
}

function isCwdObservationReady(state: SessionCwdState | null) {
  if (!state) {
    return false
  }
  if (state.observation_status !== undefined) {
    return state.observation_status === 'ready'
  }
  return state.capability === 'supported' && Boolean(state.confirmed_path)
}

function isCwdControlReady(state: SessionCwdState | null) {
  if (!state) {
    return false
  }
  if (state.control_status !== undefined) {
    return state.control_status === 'ready'
  }
  return state.capability === 'supported'
}

function canAttemptCwdRefresh(state: SessionCwdState | null) {
  if (!state) {
    return false
  }
  if (state.control_status !== undefined) {
    return (
      state.control_status === 'inactive'
      || state.control_status === 'preparing'
      || state.control_status === 'ready'
      || state.control_status === 'degraded'
    )
  }
  return state.capability === 'supported' && state.shell_phase === 'prompt'
}

function fileSessionRecoveryErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) {
      return code
    }
  }
  return 'SFTP_RECONNECT_FAILED'
}
