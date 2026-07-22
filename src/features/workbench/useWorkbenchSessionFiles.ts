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
import { fileSortValue, normalizeRemotePath } from '../files/fileUtils'
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
  isSessionFilesCwdRefreshComplete,
  reconcileSessionFilesCwdPending,
  sessionFilesCwdRefreshTransportDisposition,
  sessionFilesCwdRefreshWatchdogRemaining,
  scheduleSessionFilesCwdLocalRetry,
  scheduleSessionFilesCwdRefreshRetry,
  sessionFilesViewStatesReducer,
  shouldPrepareSessionFilesCwdControl,
  shouldRequestInitialSessionFilesDirectory,
  shouldRequestFollowedDirectory,
  updateSessionFilesViewState,
} from './sessionFilesState'
import {
  buildSourceSessionContexts,
  canApplyCreatedFileSession,
  isCurrentSourceSession,
  mergeFileSessionUpdate,
  shouldMaintainFileSessionEventStream,
} from './workbenchFileSessionLifecycle'

interface FileSessionEventMessage {
  type: string
  session?: FileSession
}

interface FileListScrollPosition {
  path: string
  scrollTop: number
}

interface UseWorkbenchSessionFilesOptions {
  api: TermousApi
  data: AppData
  activeSession: Session | null
  enabled: boolean
}

export function useWorkbenchSessionFiles({
  api,
  data,
  activeSession,
  enabled,
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
  const [createRetrySequence, setCreateRetrySequence] = useState(0)
  const mountedRef = useRef(true)
  const sourceSessionContextsRef = useRef(buildSourceSessionContexts(data.sessions))
  const fileSessionsRef = useRef(data.fileSessions)
  const creatingSessionsRef = useRef(new Set<string>())
  const createFailureSessionIdsRef = useRef(new Set<string>())
  const directoryRequestSequencesRef = useRef(new Map<string, number>())
  const directoryRequestControllersRef = useRef(new Map<string, AbortController>())
  const [cwdRefreshWakeSequence, setCwdRefreshWakeSequence] = useState(0)
  const scrollPositionsRef = useRef(new Map<string, FileListScrollPosition>())
  const listRef = useRef<HTMLDivElement>(null)

  sourceSessionContextsRef.current = buildSourceSessionContexts(data.sessions)
  fileSessionsRef.current = data.fileSessions

  useEffect(() => {
    const directoryRequestControllers = directoryRequestControllersRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      directoryRequestControllers.forEach((controller) => controller.abort())
      directoryRequestControllers.clear()
    }
  }, [])

  useEffect(() => {
    const activeIds = new Set(data.sessions.map((session) => session.id))
    dispatchViewStates({ type: 'retain', activeSessionIds: activeIds })
    setSessionOverrides((current) => Object.fromEntries(
      Object.entries(current).filter(([sessionId]) => activeIds.has(sessionId)),
    ))
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
  }, [data.sessions])

  const fileSession = useMemo(() => {
    if (!sourceSessionId) {
      return null
    }
    const override = sessionOverrides[sourceSessionId]
    const persisted = data.fileSessions.find((session) => session.source_session_id === sourceSessionId)
    if (!override) {
      return persisted ?? null
    }
    if (!persisted) {
      return override
    }
    const overrideTime = Date.parse(override.connected_at ?? override.started_at)
    const persistedTime = Date.parse(persisted.connected_at ?? persisted.started_at)
    return overrideTime >= persistedTime ? override : persisted
  }, [data.fileSessions, sessionOverrides, sourceSessionId])
  const fileSessionId = fileSession?.id ?? ''
  const fileSessionStatus = fileSession?.status ?? null

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

  const updateFileSession = useCallback((session: FileSession, resetProgress = false) => {
    if (!session.source_session_id) {
      return
    }
    setSessionOverrides((current) => {
      const sourceID = session.source_session_id as string
      const previous = current[sourceID]
        ?? fileSessionsRef.current.find((item) => item.id === session.id)
      return {
        ...current,
        [sourceID]: mergeFileSessionUpdate(previous, session, resetProgress),
      }
    })
  }, [])

  useEffect(() => {
    if (
      !enabled ||
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
    void api.createFileSession(
      sourceHostId,
      requestedSourceSessionId,
      requestedInitialPath,
    ).then((created) => {
      if (
        !mountedRef.current ||
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
        !isCurrentSourceSession(
          sourceSessionContextsRef.current,
          requestedSourceSessionId,
          sourceHostId,
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
    api,
    createRetrySequence,
    cwdState?.confirmed_path,
    enabled,
    fileSession,
    sourceHostId,
    sourceSessionId,
    sourceSessionStatus,
    updateFileSession,
    updateView,
  ])

  useEffect(() => {
    if (!fileSession?.id || !maintainFileSessionEventStream) {
      return
    }
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined
    const connect = () => {
      if (disposed) {
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
          if (message.session?.id === fileSession.id) {
            updateFileSession(message.session)
          }
        } catch {
          nextSocket.close()
        }
      })
      nextSocket.addEventListener('error', () => nextSocket.close())
      nextSocket.addEventListener('close', () => {
        if (!disposed && socket === nextSocket) {
          socket = undefined
          reconnectTimer = window.setTimeout(connect, 1200)
        }
      })
    }
    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, fileSession?.id, maintainFileSessionEventStream, updateFileSession])

  useEffect(() => {
    if (
      !fileSession ||
      fileSession.status === 'connected' ||
      fileSession.status === 'disconnected' ||
      fileSession.status === 'failed' ||
      fileSession.status === 'waiting_trust'
    ) {
      return
    }
    let disposed = false
    const refreshSession = async () => {
      try {
        const next = await api.getFileSession(fileSession.id)
        if (!disposed) {
          updateFileSession(next)
        }
      } catch {
        // WS 仍是主通道，轮询仅补偿连接阶段的事件丢失。
      }
    }
    const timer = window.setInterval(() => void refreshSession(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [api, fileSession, updateFileSession])

  const loadDirectory = useCallback(async (targetPath: string) => {
    if (!sourceSessionId || !fileSessionId || fileSessionStatus !== 'connected') {
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
      if (directoryRequestControllersRef.current.get(sourceSessionId) !== controller) {
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
  }, [api, fileSessionId, fileSessionStatus, sourceSessionId, updateView])

  useEffect(() => {
    if (
      !enabled ||
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
  }, [enabled, fileSession?.status, initialPath, loadDirectory, sourceSessionId, viewState])

  useEffect(() => {
    if (
      !enabled ||
      !viewState?.followTerminal ||
      !cwdState?.confirmed_path ||
      fileSessionStatus !== 'connected' ||
      !isCwdObservationReady(cwdState)
    ) {
      return
    }
    const confirmedPath = normalizeRemotePath(cwdState.confirmed_path)
    const pendingPath = viewState.pendingTerminalPath || (
      cwdState.pending_operation?.status === 'failed'
        ? ''
        : cwdState.pending_operation?.path ?? ''
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
    cwdState?.pending_operation?.path,
    cwdState?.pending_operation?.status,
    enabled,
    fileSessionStatus,
    loadDirectory,
    sourceSessionId,
    viewState?.pendingTerminalPath,
    viewState,
  ])

  useEffect(() => {
    if (!enabled || !viewState?.followTerminal || !cwdState) {
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
    )
    const confirmedPath = cwdState.confirmed_path
      ? normalizeRemotePath(cwdState.confirmed_path)
      : ''
    updateView(
      (state) => applySessionFilesSyncState(
        state,
        derived.status,
        derived.error,
        state.pendingTerminalPath ? '' : confirmedPath,
      ),
      initialPath,
    )
  }, [
    cwdState,
    cwdRequestError,
    cwdTransportState,
    enabled,
    initialPath,
    sourceSessionId,
    updateView,
    viewState?.cwdRefresh,
    viewState?.followTerminal,
  ])

  useEffect(() => {
    if (
      !sourceSessionId
      || !enabled
      || !viewState?.followTerminal
      || viewState.cwdRefresh.phase === 'idle'
      || viewState.cwdRefresh.phase === 'failed'
    ) {
      return
    }
    const refresh = viewState.cwdRefresh
    const now = Date.now()
    const finishRefresh = (
      error = '',
      statusOverride?: 'unsupported' | 'reconnect-required',
    ) => {
      const successState = deriveSessionFilesCwdRefreshSuccessState(cwdState)
      const confirmedPath = cwdState?.confirmed_path
        ? normalizeRemotePath(cwdState.confirmed_path)
        : ''
      updateView((state) => applySessionFilesSyncState(
        finishSessionFilesCwdRefresh(state, error),
        statusOverride ?? (error ? 'failed' : successState.status),
        error || successState.error,
        state.pendingTerminalPath ? '' : confirmedPath,
      ), initialPath)
    }

    if (
      refresh.requestId
      && cwdState
      && cwdState.source_generation !== refresh.baseSourceGeneration
    ) {
      finishRefresh('CWD_STALE')
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
        finishRefresh(cwdState.refresh_error || cwdState.refresh_error_code || 'CWD_REMOTE_FAILED')
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
      if (cwdRefreshError.retryable) {
        const retry = scheduleSessionFilesCwdRefreshRetry(refresh, Date.now())
        if (retry) {
          cwdRuntime.clearRequestError(sourceSessionId, 'cwd_refresh', refresh.requestId)
          updateView((state) => ({
            ...state,
            cwdRefresh: retry,
          }), initialPath)
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
      updateView((state) => ({
        ...state,
        cwdRefresh: reconcileSessionFilesCwdPending(
          state.cwdRefresh,
          cwdState,
          state.followTerminal,
          now,
        ),
      }), initialPath)
      return
    }

    const scheduleLocalWake = () => {
      updateView((state) => {
        const current = state.cwdRefresh
        if (
          !state.followTerminal
          || current.startedAt !== refresh.startedAt
          || current.deadlineAt !== refresh.deadlineAt
          || current.requestId !== refresh.requestId
        ) {
          return state
        }
        return {
          ...state,
          cwdRefresh: scheduleSessionFilesCwdLocalRetry(current, Date.now()),
        }
      }, initialPath)
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
      updateView((state) => ({
        ...state,
        cwdRefresh: adoptSessionFilesCwdRefreshPending(state.cwdRefresh, cwdState),
      }), initialPath)
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
        updateView((state) => ({
          ...state,
          cwdRefresh: applySessionFilesCwdRefreshDispatch(state.cwdRefresh, retryResult),
        }), initialPath)
      } else {
        scheduleLocalWake()
      }
      return () => window.clearTimeout(wakeTimer)
    }

    const result = cwdRuntime.refreshDirectory(sourceSessionId)
    if (result.status === 'queued') {
      updateView((state) => ({
        ...state,
        cwdRefresh: applySessionFilesCwdRefreshDispatch(state.cwdRefresh, result),
      }), initialPath)
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
    initialPath,
    sourceSessionId,
    sourceSessionStatus,
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
      || !sourceSessionId
      || !fileSessionId
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
        syncStatus: 'queued',
        syncError: '',
      }, targetPath)
      return
    }
    if (result.status === 'already_current') {
      updateView({ pendingTerminalPath: '', syncStatus: '', syncError: '' }, targetPath)
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
    enabled,
    fileSessionId,
    sourceSessionId,
    updateView,
    viewState?.cwdRefresh.phase,
    viewState?.followTerminal,
    viewState?.pendingTerminalPath,
  ])

  const navigateDirectory = useCallback(async (targetPath: string) => {
    if (!sourceSessionId || !fileSessionId || !viewState) {
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
    if (viewState.cwdRefresh.phase !== 'idle' || !isCwdControlReady(cwdState)) {
      const pendingState = deriveSessionFilesFollowSyncState(
        cwdState,
        cwdRequestError,
        '',
        true,
        false,
        sessionFilesCwdRefreshTransportDisposition(cwdTransportState),
      )
      updateView((state) => {
        const pending = {
          ...state,
          pendingTerminalPath: normalized,
          syncStatus: pendingState.status,
          syncError: pendingState.error,
        }
        if (
          state.cwdRefresh.phase === 'idle'
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
      return loadDirectory(normalized)
    }
    if (result.status !== 'queued') {
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
    updateView({
      path: normalized,
      pendingTerminalPath: '',
      error: '',
      syncStatus: 'queued',
      syncError: '',
    }, normalized)
    return true
  }, [cwdRequestError, cwdRuntime, cwdState, cwdTransportState, fileSessionId, loadDirectory, sourceSessionId, updateView, viewState])

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
        )
      : followTerminal
        ? deriveSessionFilesSyncState(cwdState, cwdRequestError)
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
  }, [cwdRequestError, cwdState, cwdTransportState, initialPath, sourceSessionId, updateView, viewState?.followTerminal, viewState?.listing, viewState?.requestSequence])

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

  const reconnect = useCallback(async () => {
    if (!fileSession) {
      if (sourceSessionId) {
        createFailureSessionIdsRef.current.delete(sourceSessionId)
        updateView({ error: '', loading: false }, initialPath)
        setCreateRetrySequence((current) => current + 1)
      }
      return
    }
    updateFileSession(await api.reconnectFileSession(fileSession.id), true)
  }, [api, fileSession, initialPath, sourceSessionId, updateFileSession, updateView])

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
    listRef,
    entries,
    connected: fileSession?.status === 'connected',
    loadDirectory,
    retryDirectory,
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
