import { useEffect, useMemo, useRef } from 'react'
import {
  isTerminatedFileSession,
  normalizeFileSessionEventResponse,
  terminatedFileSessionSnapshot,
  type FileSession,
} from '#entities/file'
import type { FileSessionGateway } from '#features/files'
import { TermousApiError } from '#shared/api'
import {
  subscribeFileSessionEvents,
  type FileSessionEventSubscription,
} from './fileSessionEventSubscription'

interface FileSessionEventMessage {
  type: string
  session: unknown
}

interface UseFileSessionStatusSyncOptions {
  gateway: Pick<FileSessionGateway, 'getFileSession' | 'fileSessionEventsUrl'>
  fileSessions: readonly FileSession[]
  closingFileSessionIds: ReadonlySet<string>
  onUpdateFileSession: (session: FileSession) => void
}

export function useFileSessionStatusSync({
  gateway,
  fileSessions,
  closingFileSessionIds,
  onUpdateFileSession,
}: UseFileSessionStatusSyncOptions) {
  const subscriptionsRef = useRef(new Map<string, FileSessionEventSubscription>())
  const fileSessionsRef = useRef(fileSessions)
  const onUpdateFileSessionRef = useRef(onUpdateFileSession)
  fileSessionsRef.current = fileSessions

  useEffect(() => {
    onUpdateFileSessionRef.current = onUpdateFileSession
  }, [onUpdateFileSession])

  const socketFileSessionIds = useMemo(
    () => fileSessions
      .filter((session) => (
        !closingFileSessionIds.has(session.id)
        && !isTerminatedFileSession(session)
      ))
      .map((session) => session.id)
      .join('|'),
    [closingFileSessionIds, fileSessions],
  )
  const pollingFileSessionIds = useMemo(
    () => fileSessions
      .filter((session) => (
        !closingFileSessionIds.has(session.id)
        && (session.status === 'connecting' || session.status === 'waiting_trust')
      ))
      .map((session) => session.id)
      .join('|'),
    [closingFileSessionIds, fileSessions],
  )

  useEffect(() => {
    const ids = new Set(
      socketFileSessionIds ? socketFileSessionIds.split('|') : [],
    )
    subscriptionsRef.current.forEach((subscription, fileSessionId) => {
      if (!ids.has(fileSessionId)) {
        subscriptionsRef.current.delete(fileSessionId)
        subscription.dispose()
      }
    })
    ids.forEach((fileSessionId) => {
      if (subscriptionsRef.current.has(fileSessionId)) {
        return
      }
      const subscription = subscribeFileSessionEvents({
        createSocket: () => new WebSocket(gateway.fileSessionEventsUrl(fileSessionId)),
        getSnapshot: async () => {
          const snapshot = await gateway.getFileSession(fileSessionId)
          if (snapshot.id !== fileSessionId) {
            throw new Error('file session snapshot identity mismatch')
          }
          return snapshot
        },
        onSnapshot: (snapshot) => onUpdateFileSessionRef.current(snapshot),
        onMessage: (data) => {
          const message = JSON.parse(String(data)) as FileSessionEventMessage
          if (!message.session) {
            return false
          }
          const session = normalizeFileSessionEventResponse(message.session)
          if (session.id !== fileSessionId) {
            throw new Error('file session event identity mismatch')
          }
          if (message.type === 'closed') {
            onUpdateFileSessionRef.current(
              terminatedFileSessionSnapshot(session),
            )
            return 'stop'
          }
          onUpdateFileSessionRef.current(session)
          return true
        },
        onSnapshotError: (error) => {
          if (!isMissingFileSessionError(error)) {
            return 'retry'
          }
          const current = fileSessionsRef.current.find(
            (session) => session.id === fileSessionId,
          )
          if (current) {
            onUpdateFileSessionRef.current(
              terminatedFileSessionSnapshot(current),
            )
          }
          return 'stop'
        },
      })
      subscriptionsRef.current.set(fileSessionId, subscription)
    })
  }, [gateway, socketFileSessionIds])

  useEffect(
    () => () => {
      const subscriptions = [...subscriptionsRef.current.values()]
      subscriptionsRef.current.clear()
      subscriptions.forEach((subscription) => subscription.dispose())
    },
    [],
  )

  useEffect(() => {
    const ids = pollingFileSessionIds ? pollingFileSessionIds.split('|') : []
    if (ids.length === 0) {
      return undefined
    }
    let disposed = false
    const syncSessions = async () => {
      await Promise.all(
        ids.map(async (fileSessionId) => {
          try {
            const session = await gateway.getFileSession(fileSessionId)
            if (!disposed && session.id === fileSessionId) {
              onUpdateFileSessionRef.current(session)
            }
          } catch {
            // 事件流可能会因窗口休眠或网络抖动漏帧，轮询兜底失败时保持当前 UI 状态即可。
          }
        }),
      )
    }
    void syncSessions()
    const timer = window.setInterval(() => {
      void syncSessions()
    }, 1_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [gateway, pollingFileSessionIds])
}

function isMissingFileSessionError(error: unknown) {
  if (error instanceof TermousApiError) {
    return error.code === 'SFTP_FILE_SESSION_NOT_FOUND'
  }
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'SFTP_FILE_SESSION_NOT_FOUND',
  )
}
