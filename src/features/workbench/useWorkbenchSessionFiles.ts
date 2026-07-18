import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type {
  AppData,
  FileSession,
  RemoteFileEntry,
  Session,
} from '../../types/domain'
import { fileSortValue, normalizeRemotePath } from '../files/fileUtils'
import { useSessionCwdState, useTerminalCwdRuntime } from '../terminal/terminalCwdContext'
import {
  applySessionFilesSyncState,
  beginDirectoryRequest,
  completeDirectoryRequest,
  failDirectoryRequest,
  getSessionFilesViewState,
  removeInactiveSessionFileStates,
  updateSessionFilesViewState,
  type SessionFilesSyncStatus,
  type SessionFilesViewStateMap,
} from './sessionFilesState'

interface FileSessionEventMessage {
  type: string
  session?: FileSession
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
  const cwdState = useSessionCwdState(sourceSessionId)
  const [viewStates, setViewStates] = useState<SessionFilesViewStateMap>({})
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, FileSession>>({})
  const [createRetrySequence, setCreateRetrySequence] = useState(0)
  const creatingSessionsRef = useRef(new Set<string>())
  const createFailureSessionIdsRef = useRef(new Set<string>())
  const directoryRequestSequencesRef = useRef(new Map<string, number>())
  const listRef = useRef<HTMLDivElement>(null)

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

  const initialPath = cwdState?.confirmed_path || fileSession?.current_path || '/'
  const viewState = sourceSessionId
    ? getSessionFilesViewState(viewStates, sourceSessionId, initialPath)
    : null

  const updateView = useCallback((
    update: Parameters<typeof updateSessionFilesViewState>[2],
    initial = '/',
  ) => {
    if (!sourceSessionId) {
      return
    }
    setViewStates((current) => updateSessionFilesViewState(current, sourceSessionId, update, initial))
  }, [sourceSessionId])

  const updateFileSession = useCallback((session: FileSession) => {
    if (!session.source_session_id) {
      return
    }
    setSessionOverrides((current) => ({
      ...current,
      [session.source_session_id as string]: session,
    }))
  }, [])

  useEffect(() => {
    if (
      !enabled ||
      !activeSession ||
      activeSession.kind !== 'ssh' ||
      activeSession.status !== 'connected' ||
      !activeSession.host_id ||
      fileSession ||
      createFailureSessionIdsRef.current.has(activeSession.id) ||
      creatingSessionsRef.current.has(activeSession.id)
    ) {
      return
    }
    let disposed = false
    creatingSessionsRef.current.add(activeSession.id)
    void api.createFileSession(
      activeSession.host_id,
      activeSession.id,
      cwdState?.confirmed_path || '/',
    ).then((created) => {
      if (!disposed) {
        createFailureSessionIdsRef.current.delete(activeSession.id)
        updateFileSession(created)
      }
    }).catch((error) => {
      if (!disposed) {
        createFailureSessionIdsRef.current.add(activeSession.id)
        const message = error instanceof Error ? error.message : ''
        updateView({ error: message || 'file_session_create_failed', loading: false }, cwdState?.confirmed_path || '/')
      }
    }).finally(() => {
      creatingSessionsRef.current.delete(activeSession.id)
    })
    return () => {
      disposed = true
    }
  }, [activeSession, api, createRetrySequence, cwdState?.confirmed_path, enabled, fileSession, updateFileSession, updateView])

  useEffect(() => {
    if (!fileSession?.id) {
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
  }, [api, fileSession?.id, updateFileSession])

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
    if (!sourceSessionId || !fileSession || fileSession.status !== 'connected') {
      return false
    }
    const normalized = normalizeRemotePath(targetPath)
    const sequence = (directoryRequestSequencesRef.current.get(sourceSessionId) ?? 0) + 1
    directoryRequestSequencesRef.current.set(sourceSessionId, sequence)
    setViewStates((current) => {
      const currentView = getSessionFilesViewState(current, sourceSessionId, normalized)
      const request = beginDirectoryRequest(currentView, normalized, sequence)
      return { ...current, [sourceSessionId]: request.state }
    })
    try {
      const listing = await api.listFileSessionFiles(fileSession.id, normalized)
      setViewStates((current) => updateSessionFilesViewState(
        current,
        sourceSessionId,
        (state) => completeDirectoryRequest(state, sequence, listing),
        normalized,
      ))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setViewStates((current) => updateSessionFilesViewState(
        current,
        sourceSessionId,
        (state) => failDirectoryRequest(state, sequence, message),
        normalized,
      ))
      return false
    }
  }, [api, fileSession, sourceSessionId])

  useEffect(() => {
    if (
      !enabled ||
      !sourceSessionId ||
      fileSession?.status !== 'connected' ||
      viewState?.listing ||
      viewState?.loading ||
      viewState?.error
    ) {
      return
    }
    void loadDirectory(viewState?.path || initialPath)
  }, [enabled, fileSession?.status, initialPath, loadDirectory, sourceSessionId, viewState?.error, viewState?.listing, viewState?.loading, viewState?.path])

  useEffect(() => {
    if (
      !enabled ||
      !viewState?.followTerminal ||
      !cwdState?.confirmed_path ||
      fileSession?.status !== 'connected'
    ) {
      return
    }
    const confirmedPath = normalizeRemotePath(cwdState.confirmed_path)
    if (confirmedPath === viewState.path && viewState.listing?.path === confirmedPath) {
      return
    }
    const timer = window.setTimeout(() => void loadDirectory(confirmedPath), 140)
    return () => window.clearTimeout(timer)
  }, [cwdState?.confirmed_path, enabled, fileSession?.status, loadDirectory, viewState?.followTerminal, viewState?.listing?.path, viewState?.path])

  useEffect(() => {
    if (!enabled || !viewState?.followTerminal || !cwdState) {
      return
    }
    const pending = cwdState.pending_operation
    const nextStatus: SessionFilesSyncStatus = pending?.status
      ?? (cwdState.capability === 'unsupported' ? 'unsupported' : '')
    const nextError = pending?.error ?? cwdState.capability_cause ?? ''
    const confirmedPath = cwdState.confirmed_path
      ? normalizeRemotePath(cwdState.confirmed_path)
      : ''
    updateView(
      (state) => applySessionFilesSyncState(state, nextStatus, nextError, confirmedPath),
      initialPath,
    )
  }, [
    cwdState,
    enabled,
    initialPath,
    updateView,
    viewState?.followTerminal,
  ])

  useEffect(() => {
    const scrollTop = viewState?.scrollTop
    if (scrollTop === undefined || !listRef.current) {
      return
    }
    listRef.current.scrollTop = scrollTop
  }, [sourceSessionId, viewState?.listing?.path, viewState?.scrollTop])

  const navigateDirectory = useCallback(async (targetPath: string) => {
    if (!sourceSessionId || !fileSession || !viewState) {
      return false
    }
    const normalized = normalizeRemotePath(targetPath)
    if (!viewState.followTerminal) {
      return loadDirectory(normalized)
    }
    const result = cwdRuntime.requestDirectoryChange(sourceSessionId, fileSession.id, normalized)
    if (result.status === 'already_current') {
      return loadDirectory(normalized)
    }
    if (result.status !== 'queued') {
      updateView({
        syncStatus: result.status,
        syncError: result.status === 'unsupported' ? result.reason ?? '' : '',
      }, normalized)
      return false
    }
    updateView({
      path: normalized,
      error: '',
      syncStatus: 'queued',
      syncError: '',
    }, normalized)
    return true
  }, [cwdRuntime, fileSession, loadDirectory, sourceSessionId, updateView, viewState])

  const setFollowTerminal = useCallback((followTerminal: boolean) => {
    updateView({
      followTerminal,
      error: '',
      syncStatus: followTerminal && cwdState?.capability === 'unsupported' ? 'unsupported' : '',
      syncError: followTerminal ? cwdState?.capability_cause ?? '' : '',
    }, initialPath)
    if (followTerminal && cwdState?.confirmed_path) {
      void loadDirectory(cwdState.confirmed_path)
    }
  }, [cwdState?.capability, cwdState?.capability_cause, cwdState?.confirmed_path, initialPath, loadDirectory, updateView])

  const setSelectedPaths = useCallback((selectedPaths: string[]) => {
    updateView({ selectedPaths }, initialPath)
  }, [initialPath, updateView])

  const recordScroll = useCallback(() => {
    if (listRef.current) {
      updateView({ scrollTop: listRef.current.scrollTop }, initialPath)
    }
  }, [initialPath, updateView])

  const reconnect = useCallback(async () => {
    if (!fileSession) {
      if (sourceSessionId) {
        createFailureSessionIdsRef.current.delete(sourceSessionId)
        updateView({ error: '', loading: false }, initialPath)
        setCreateRetrySequence((current) => current + 1)
      }
      return
    }
    updateFileSession(await api.reconnectFileSession(fileSession.id))
  }, [api, fileSession, initialPath, sourceSessionId, updateFileSession, updateView])

  return {
    sourceSessionId,
    fileSession,
    viewState,
    cwdState,
    listRef,
    entries: [...(viewState?.listing?.entries ?? [])].sort((left, right) => fileSortValue(left).localeCompare(fileSortValue(right))),
    connected: fileSession?.status === 'connected',
    loadDirectory,
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
