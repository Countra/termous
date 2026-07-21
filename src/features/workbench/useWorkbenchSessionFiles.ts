import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type {
  AppData,
  FileSession,
  RemoteFileEntry,
  Session,
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
  applySessionFilesSyncState,
  beginDirectoryRequest,
  cancelDirectoryRequest,
  cancelDirectoryRequestForFollowRefresh,
  completeDirectoryRequest,
  deriveRejectedSessionFilesSyncState,
  deriveSessionFilesCwdRefreshSuccessState,
  deriveSessionFilesFollowSyncState,
  deriveSessionFilesSyncState,
  ensureSessionFilesCwdRefreshTransportWaitDeadline,
  failDirectoryRequest,
  getSessionFilesViewState,
  isSessionFilesCwdRefreshComplete,
  removeInactiveSessionFileStates,
  sessionFilesCwdRefreshRetryDelay,
  sessionFilesCwdRefreshTransportDisposition,
  sessionFilesCwdRefreshTransportWaitRemaining,
  shouldRefreshFollowedDirectory,
  shouldRequestInitialSessionFilesDirectory,
  shouldRequestFollowedDirectory,
  updateSessionFilesViewState,
  type SessionFilesViewStateMap,
  type SessionFilesCwdRefreshBaseline,
  type SessionFilesCwdRefreshFlight,
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

const cwdRefreshRequestTimeoutMs = 10_000
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
  const [viewStates, setViewStates] = useState<SessionFilesViewStateMap>({})
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, FileSession>>({})
  const [createRetrySequence, setCreateRetrySequence] = useState(0)
  const mountedRef = useRef(true)
  const sourceSessionContextsRef = useRef(buildSourceSessionContexts(data.sessions))
  const fileSessionsRef = useRef(data.fileSessions)
  const creatingSessionsRef = useRef(new Set<string>())
  const createFailureSessionIdsRef = useRef(new Set<string>())
  const directoryRequestSequencesRef = useRef(new Map<string, number>())
  const directoryRequestControllersRef = useRef(new Map<string, AbortController>())
  const cwdRefreshPendingSessionIdsRef = useRef(new Set<string>())
  const cwdRefreshFlightsRef = useRef(new Map<string, SessionFilesCwdRefreshFlight>())
  const cwdRefreshAttemptsRef = useRef(new Map<string, number>())
  const cwdRefreshRetryAtRef = useRef(new Map<string, number>())
  const cwdRefreshBaselinesRef = useRef(new Map<string, SessionFilesCwdRefreshBaseline>())
  const cwdRefreshTerminalErrorsRef = useRef(new Map<string, string>())
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
    setViewStates((current) => removeInactiveSessionFileStates(current, activeIds))
    setSessionOverrides((current) => Object.fromEntries(
      Object.entries(current).filter(([sessionId]) => activeIds.has(sessionId)),
    ))
    createFailureSessionIdsRef.current = new Set(
      [...createFailureSessionIdsRef.current].filter((sessionId) => activeIds.has(sessionId)),
    )
    directoryRequestSequencesRef.current = new Map(
      [...directoryRequestSequencesRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    cwdRefreshPendingSessionIdsRef.current = new Set(
      [...cwdRefreshPendingSessionIdsRef.current].filter((sessionId) => activeIds.has(sessionId)),
    )
    cwdRefreshFlightsRef.current = new Map(
      [...cwdRefreshFlightsRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    cwdRefreshAttemptsRef.current = new Map(
      [...cwdRefreshAttemptsRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    cwdRefreshRetryAtRef.current = new Map(
      [...cwdRefreshRetryAtRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    cwdRefreshBaselinesRef.current = new Map(
      [...cwdRefreshBaselinesRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
    )
    cwdRefreshTerminalErrorsRef.current = new Map(
      [...cwdRefreshTerminalErrorsRef.current].filter(([sessionId]) => activeIds.has(sessionId)),
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
    setViewStates((current) => updateSessionFilesViewState(current, sourceSessionId, update, initial))
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
    setViewStates((current) => {
      const currentView = getSessionFilesViewState(current, sourceSessionId, normalized)
      const request = beginDirectoryRequest(currentView, normalized, sequence)
      return { ...current, [sourceSessionId]: request.state }
    })
    try {
      const listing = await api.listFileSessionFiles(fileSessionId, normalized, {
        signal: controller.signal,
      })
      if (directoryRequestControllersRef.current.get(sourceSessionId) !== controller) {
        return false
      }
      setViewStates((current) => updateSessionFilesViewState(
        current,
        sourceSessionId,
        (state) => completeDirectoryRequest(state, sequence, listing),
        normalized,
      ))
      return true
    } catch (error) {
      if (directoryRequestControllersRef.current.get(sourceSessionId) !== controller) {
        return false
      }
      const message = error instanceof Error ? error.message : ''
      setViewStates((current) => updateSessionFilesViewState(
        current,
        sourceSessionId,
        (state) => failDirectoryRequest(state, sequence, message, normalized),
        normalized,
      ))
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
      cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId) ||
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
      (sourceSessionId && cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId))
    ) {
      return
    }
    const confirmedPath = normalizeRemotePath(cwdState.confirmed_path)
    const pendingPath = cwdState.pending_operation?.status === 'failed'
      ? ''
      : cwdState.pending_operation?.path ?? ''
    if (!shouldRequestFollowedDirectory(viewState, confirmedPath, pendingPath)) {
      return
    }
    const timer = window.setTimeout(() => {
      if (
        !sourceSessionId
        || cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId)
      ) {
        return
      }
      void loadDirectory(confirmedPath)
    }, 140)
    return () => window.clearTimeout(timer)
  }, [
    cwdState?.confirmed_path,
    cwdState?.pending_operation?.path,
    cwdState?.pending_operation?.status,
    enabled,
    fileSessionStatus,
    loadDirectory,
    sourceSessionId,
    viewState,
  ])

  useEffect(() => {
    if (!enabled || !viewState?.followTerminal || !cwdState) {
      return
    }
    const refreshBaseline = sourceSessionId
      ? cwdRefreshBaselinesRef.current.get(sourceSessionId)
      : undefined
    const refreshConfirmed = refreshBaseline
      ? isSessionFilesCwdRefreshComplete(cwdState, refreshBaseline)
      : false
    const terminalRefreshError = sourceSessionId && !refreshConfirmed
      ? cwdRefreshTerminalErrorsRef.current.get(sourceSessionId)
      : ''
    const derived = deriveSessionFilesFollowSyncState(
      cwdState,
      cwdRequestError,
      terminalRefreshError ?? '',
      Boolean(sourceSessionId && cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId)),
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
        confirmedPath,
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
    viewState?.followTerminal,
  ])

  useEffect(() => {
    if (!sourceSessionId) {
      return
    }
    if (!viewState?.followTerminal) {
      cwdRefreshPendingSessionIdsRef.current.delete(sourceSessionId)
      cwdRefreshFlightsRef.current.delete(sourceSessionId)
      cwdRefreshAttemptsRef.current.delete(sourceSessionId)
      cwdRefreshRetryAtRef.current.delete(sourceSessionId)
      cwdRefreshBaselinesRef.current.delete(sourceSessionId)
      cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
      return
    }

    let wakeTimer: number | undefined
    const updateRefreshStatus = (status: 'locating' | 'failed', error = '') => {
      updateView({ syncStatus: status, syncError: error }, initialPath)
    }
    const clearRefresh = () => {
      cwdRefreshPendingSessionIdsRef.current.delete(sourceSessionId)
      cwdRefreshFlightsRef.current.delete(sourceSessionId)
      cwdRefreshAttemptsRef.current.delete(sourceSessionId)
      cwdRefreshRetryAtRef.current.delete(sourceSessionId)
      cwdRefreshBaselinesRef.current.delete(sourceSessionId)
      cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
    }
    const stopRefresh = (error: string) => {
      cwdRefreshPendingSessionIdsRef.current.delete(sourceSessionId)
      cwdRefreshFlightsRef.current.delete(sourceSessionId)
      cwdRefreshAttemptsRef.current.delete(sourceSessionId)
      cwdRefreshRetryAtRef.current.delete(sourceSessionId)
      cwdRefreshTerminalErrorsRef.current.set(sourceSessionId, error)
      updateRefreshStatus('failed', error)
    }
    const scheduleRetry = (error: string) => {
      cwdRefreshFlightsRef.current.delete(sourceSessionId)
      const attempt = cwdRefreshAttemptsRef.current.get(sourceSessionId) ?? 0
      const delay = sessionFilesCwdRefreshRetryDelay(attempt)
      if (delay === null) {
        stopRefresh(error)
        return
      }
      cwdRefreshRetryAtRef.current.set(sourceSessionId, Date.now() + delay)
      setCwdRefreshWakeSequence((current) => current + 1)
    }

    let baseline = cwdRefreshBaselinesRef.current.get(sourceSessionId)
    if (baseline && isSessionFilesCwdRefreshComplete(cwdState, baseline)) {
      clearRefresh()
      const derived = deriveSessionFilesCwdRefreshSuccessState(cwdState)
      updateView(
        (state) => applySessionFilesSyncState(
          state,
          derived.status,
          derived.error,
          cwdState?.confirmed_path ? normalizeRemotePath(cwdState.confirmed_path) : '',
        ),
        initialPath,
      )
      return
    }
    if (cwdState?.capability === 'unsupported') {
      clearRefresh()
      const derived = deriveSessionFilesSyncState(cwdState, cwdRequestError)
      updateView(
        (state) => applySessionFilesSyncState(
          state,
          derived.status,
          derived.error,
          cwdState.confirmed_path ? normalizeRemotePath(cwdState.confirmed_path) : '',
        ),
        initialPath,
      )
      return
    }
    if (!enabled || sourceSessionStatus !== 'connected') {
      return
    }
    if (!cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId)) {
      return
    }

    const transportDisposition = sessionFilesCwdRefreshTransportDisposition(cwdTransportState)
    if (cwdState?.capability === 'probing') {
      if (transportDisposition === 'failed') {
        stopRefresh('cwd_refresh_transport_unavailable')
        return
      }
      const pendingState = deriveSessionFilesFollowSyncState(
        cwdState,
        cwdRequestError,
        '',
        true,
        false,
        transportDisposition,
      )
      updateView({
        syncStatus: pendingState.status,
        syncError: pendingState.error,
      }, initialPath)
      return
    }

    const waitForTransport = () => {
      const now = Date.now()
      const deadline = ensureSessionFilesCwdRefreshTransportWaitDeadline(
        baseline?.transportWaitDeadline ?? 0,
        now,
      )
      if (!baseline || baseline.transportWaitDeadline !== deadline) {
        baseline = {
          baseRefreshSequence: baseline?.baseRefreshSequence ?? cwdState?.refresh_seq ?? 0,
          baseConfirmedPath: baseline?.baseConfirmedPath ?? cwdState?.confirmed_path ?? '',
          transportWaitDeadline: deadline,
        }
        cwdRefreshBaselinesRef.current.set(sourceSessionId, baseline)
      }
      const waitRemaining = sessionFilesCwdRefreshTransportWaitRemaining(
        deadline,
        now,
      )
      if (waitRemaining <= 0) {
        stopRefresh('cwd_refresh_transport_timeout')
        return undefined
      }
      const pendingState = deriveSessionFilesFollowSyncState(
        cwdState,
        cwdRequestError,
        '',
        true,
        false,
        transportDisposition,
      )
      updateView({
        syncStatus: pendingState.status,
        syncError: pendingState.error,
      }, initialPath)
      wakeTimer = window.setTimeout(
        () => setCwdRefreshWakeSequence((current) => current + 1),
        waitRemaining,
      )
      return () => window.clearTimeout(wakeTimer)
    }
    const flight = cwdRefreshFlightsRef.current.get(sourceSessionId)
    if (flight) {
      if (cwdRefreshError?.request_id === flight.requestId) {
        if (cwdRefreshError.retryable) {
          scheduleRetry(cwdRefreshError.code)
        } else {
          stopRefresh(cwdRefreshError.code)
        }
        return
      }
      if (transportDisposition === 'failed') {
        stopRefresh('cwd_refresh_transport_unavailable')
        return
      }
      if (transportDisposition === 'wait') {
        cwdRefreshFlightsRef.current.delete(sourceSessionId)
        cwdRefreshAttemptsRef.current.delete(sourceSessionId)
        return waitForTransport()
      }
      const timeoutRemaining = cwdRefreshRequestTimeoutMs - (Date.now() - flight.startedAt)
      if (timeoutRemaining <= 0) {
        scheduleRetry('cwd_refresh_timeout')
        return
      }
      wakeTimer = window.setTimeout(() => {
        const current = cwdRefreshFlightsRef.current.get(sourceSessionId)
        if (current?.requestId === flight.requestId) {
          scheduleRetry('cwd_refresh_timeout')
        }
      }, timeoutRemaining)
      return () => window.clearTimeout(wakeTimer)
    }

    if (transportDisposition === 'failed') {
      stopRefresh('cwd_refresh_transport_unavailable')
      return
    }
    if (transportDisposition === 'wait') {
      return waitForTransport()
    }

    const retryAt = cwdRefreshRetryAtRef.current.get(sourceSessionId)
    if (retryAt !== undefined) {
      const retryDelay = retryAt - Date.now()
      if (retryDelay > 0) {
        wakeTimer = window.setTimeout(
          () => setCwdRefreshWakeSequence((current) => current + 1),
          retryDelay,
        )
        return () => window.clearTimeout(wakeTimer)
      }
      cwdRefreshRetryAtRef.current.delete(sourceSessionId)
    }

    if (!shouldRefreshFollowedDirectory(true, cwdState, true)) {
      return
    }
    cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
    const pendingState = deriveSessionFilesFollowSyncState(
      cwdState,
      cwdRequestError,
      '',
      true,
      false,
      transportDisposition,
    )
    updateView({
      syncStatus: pendingState.status,
      syncError: pendingState.error,
    }, initialPath)
    const result = cwdRuntime.refreshDirectory(sourceSessionId)
    if (result.status === 'not_ready') {
      return
    }
    const refreshBaseline = cwdRefreshBaselinesRef.current.get(sourceSessionId) ?? {
      baseRefreshSequence: result.baseRefreshSequence,
      baseConfirmedPath: cwdState?.confirmed_path ?? '',
      transportWaitDeadline: 0,
    }
    cwdRefreshBaselinesRef.current.set(sourceSessionId, refreshBaseline)
    cwdRefreshFlightsRef.current.set(sourceSessionId, {
      requestId: result.requestId,
      ...refreshBaseline,
      startedAt: Date.now(),
    })
    cwdRefreshAttemptsRef.current.set(
      sourceSessionId,
      (cwdRefreshAttemptsRef.current.get(sourceSessionId) ?? 0) + 1,
    )
    setCwdRefreshWakeSequence((current) => current + 1)
    return () => {
      if (wakeTimer !== undefined) {
        window.clearTimeout(wakeTimer)
      }
    }
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
    if (cwdRefreshPendingSessionIdsRef.current.has(sourceSessionId)) {
      const pendingState = deriveSessionFilesFollowSyncState(
        cwdState,
        cwdRequestError,
        '',
        true,
        false,
        sessionFilesCwdRefreshTransportDisposition(cwdTransportState),
      )
      updateView({
        syncStatus: pendingState.status,
        syncError: pendingState.error,
      }, normalized)
      return false
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
    cwdRefreshPendingSessionIdsRef.current.delete(sourceSessionId)
    cwdRefreshFlightsRef.current.delete(sourceSessionId)
    cwdRefreshAttemptsRef.current.delete(sourceSessionId)
    cwdRefreshRetryAtRef.current.delete(sourceSessionId)
    cwdRefreshBaselinesRef.current.delete(sourceSessionId)
    cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
    updateView({
      path: normalized,
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
    if (sourceSessionId) {
      if (startsRefresh) {
        cwdRefreshPendingSessionIdsRef.current.add(sourceSessionId)
        cwdRefreshFlightsRef.current.delete(sourceSessionId)
        cwdRefreshAttemptsRef.current.delete(sourceSessionId)
        cwdRefreshRetryAtRef.current.delete(sourceSessionId)
        cwdRefreshBaselinesRef.current.set(sourceSessionId, {
          baseRefreshSequence: cwdState?.refresh_seq ?? 0,
          baseConfirmedPath: cwdState?.confirmed_path ?? '',
          transportWaitDeadline: 0,
        })
        cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
      } else if (!followTerminal) {
        cwdRefreshPendingSessionIdsRef.current.delete(sourceSessionId)
        cwdRefreshFlightsRef.current.delete(sourceSessionId)
        cwdRefreshAttemptsRef.current.delete(sourceSessionId)
        cwdRefreshRetryAtRef.current.delete(sourceSessionId)
        cwdRefreshBaselinesRef.current.delete(sourceSessionId)
        cwdRefreshTerminalErrorsRef.current.delete(sourceSessionId)
      }
    }
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
      return {
        ...next,
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
