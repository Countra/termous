import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  includeActiveFileSessionClosure,
  pruneRetiredFileSessionIds,
  selectActiveFileSessionAfterConnect,
  selectFileSessionCloseFallback,
  type FileSession,
  type FileSessionClosureState,
  type FileSessionConnectInput,
} from '#entities/file'

type ConnectFileSession = (input: FileSessionConnectInput) => Promise<FileSession>

interface UseFileSessionCoordinatorOptions {
  fileSessions: FileSession[]
  fileSessionClosures: Readonly<Record<string, FileSessionClosureState>>
  connectFileSession: ConnectFileSession
  closeFileSession: (fileSessionId: string) => Promise<void>
  supersedeFileSessionRecovery: (fileSessionId: string) => void
  onCloseError: (error: unknown) => void
}

export function useFileSessionCoordinator({
  fileSessions,
  fileSessionClosures,
  connectFileSession,
  closeFileSession: closeFileSessionRequest,
  supersedeFileSessionRecovery,
  onCloseError,
}: UseFileSessionCoordinatorOptions) {
  const [activeFileSessionId, setActiveFileSessionId] = useState('')
  const [closingFileSessionIds, setClosingFileSessionIds] = useState<string[]>([])
  const closingFileSessionIdsRef = useRef(new Set<string>())
  const retiredFileSessionIdsRef = useRef(new Set<string>())
  const fileSessionsRef = useRef(fileSessions)
  const fileSessionClosuresRef = useRef(fileSessionClosures)
  fileSessionsRef.current = fileSessions
  fileSessionClosuresRef.current = fileSessionClosures

  useEffect(() => {
    pruneRetiredFileSessionIds(
      retiredFileSessionIdsRef.current,
      fileSessions,
      fileSessionClosures,
    )
  }, [fileSessionClosures, fileSessions])

  useEffect(() => {
    if (!activeFileSessionId && fileSessions[0]) {
      setActiveFileSessionId(fileSessions[0].id)
      return
    }
    const activeClosureExists = Object.values(fileSessionClosures).some(
      (closure) => closure.session.id === activeFileSessionId,
    )
    if (
      activeFileSessionId
      && !activeClosureExists
      && !fileSessions.some((session) => session.id === activeFileSessionId)
    ) {
      setActiveFileSessionId(fileSessions[0]?.id ?? '')
    }
  }, [activeFileSessionId, fileSessionClosures, fileSessions])

  const displayedFileSessions = useMemo(
    () => includeActiveFileSessionClosure(
      fileSessions,
      fileSessionClosures,
      activeFileSessionId,
    ),
    [activeFileSessionId, fileSessionClosures, fileSessions],
  )

  const activeFileSession = useMemo(
    () => displayedFileSessions.find((session) => session.id === activeFileSessionId)
      ?? displayedFileSessions[0]
      ?? null,
    [activeFileSessionId, displayedFileSessions],
  )

  const activateFileSession = useCallback((fileSessionId: string) => {
    setActiveFileSessionId(fileSessionId)
  }, [])

  const connectAndActivateFileSession = useCallback<ConnectFileSession>(async (input) => {
    const fileSession = await connectFileSession(input)
    retiredFileSessionIdsRef.current.delete(fileSession.id)
    setActiveFileSessionId((current) => selectActiveFileSessionAfterConnect(
      current,
      fileSession.id,
      input.replacedFileSessionId,
    ))
    return fileSession
  }, [connectFileSession])

  const selectCloseFallback = useCallback((fileSessionId: string) => {
    setActiveFileSessionId((current) => {
      if (current !== fileSessionId) {
        return current
      }
      return selectFileSessionCloseFallback(
        fileSessionsRef.current,
        fileSessionClosuresRef.current,
        new Set([
          ...closingFileSessionIdsRef.current,
          ...retiredFileSessionIdsRef.current,
        ]),
      )
    })
  }, [])

  const closeFileSession = useCallback(async (fileSessionId: string) => {
    const isClosedLocalSnapshot = !fileSessionsRef.current.some(
      (session) => session.id === fileSessionId,
    ) && Object.values(fileSessionClosuresRef.current).some(
      (closure) => closure.phase === 'closed' && closure.session.id === fileSessionId,
    )
    if (isClosedLocalSnapshot) {
      supersedeFileSessionRecovery(fileSessionId)
      retiredFileSessionIdsRef.current.add(fileSessionId)
      selectCloseFallback(fileSessionId)
      return
    }
    if (closingFileSessionIdsRef.current.has(fileSessionId)) {
      return
    }
    closingFileSessionIdsRef.current.add(fileSessionId)
    setClosingFileSessionIds([...closingFileSessionIdsRef.current])
    try {
      await closeFileSessionRequest(fileSessionId)
      retiredFileSessionIdsRef.current.add(fileSessionId)
      selectCloseFallback(fileSessionId)
    } catch (error) {
      onCloseError(error)
    } finally {
      closingFileSessionIdsRef.current.delete(fileSessionId)
      setClosingFileSessionIds([...closingFileSessionIdsRef.current])
    }
  }, [closeFileSessionRequest, onCloseError, selectCloseFallback, supersedeFileSessionRecovery])

  return {
    displayedFileSessions,
    activeFileSession,
    closingFileSessionIds,
    activateFileSession,
    connectAndActivateFileSession,
    closeFileSession,
  }
}
