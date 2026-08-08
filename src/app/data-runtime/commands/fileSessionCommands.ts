import { TermousApiError } from '#shared/api'
import {
  adoptSuppressedFileSessionRecoveryResult,
  cleanupSuppressedFileSessionRecoveryResult,
  replaceFileSessionSnapshot,
  runQueuedFileSessionRecoveryOperation,
  suppressFileSessionRecoveryResult,
  upsertFileSessionSnapshot,
  type FileSession,
  type FileSessionClosureState,
} from '#entities/file'
import type { FileSessionCommandGateway } from '../api/runtimeGatewayContracts'
import {
  bumpSessionRevision,
  removeMatchingFileSessionClosure,
} from '../model/appDataState'
import type { SetAppData, SetRuntimeState } from '../model/runtimeTypes'

interface FileSessionCommandDependencies {
  api: FileSessionCommandGateway
  fileSessions: FileSession[]
  setData: SetAppData
  setFileSessionClosures: SetRuntimeState<Record<string, FileSessionClosureState>>
  fileSessionRecoveryCloseEpochs: Map<string, number>
  fileSessionRecoveryQueues: Map<string, Promise<void>>
  suppressedFileSessionIds: Map<string, string>
  fileSessionEventRevisions: Map<string, number>
  releaseFileSessionRecoveryEpoch: (fileSessionId: string) => void
  scheduleSuppressedFileSessionCleanup: (
    fileSessionId: string,
    originalSessionId: string,
  ) => void
  supersedeFileSessionRecoveryOperation: (fileSessionId: string) => void
}

export function createFileSessionCommands({
  api,
  fileSessions,
  setData,
  setFileSessionClosures,
  fileSessionRecoveryCloseEpochs,
  fileSessionRecoveryQueues,
  suppressedFileSessionIds,
  fileSessionEventRevisions,
  releaseFileSessionRecoveryEpoch,
  scheduleSuppressedFileSessionCleanup,
  supersedeFileSessionRecoveryOperation,
}: FileSessionCommandDependencies) {
  return {
    async connectFileSession(
      hostId: string,
      sourceSessionId = '',
      initialPath = '',
      replacedFileSessionId = '',
    ) {
      if (replacedFileSessionId) {
        bumpSessionRevision(fileSessionEventRevisions, replacedFileSessionId)
      }
      const createFileSession = () => (
        api.createFileSession(hostId, sourceSessionId, initialPath)
      )
      const fileSession = replacedFileSessionId
        ? await runQueuedFileSessionRecoveryOperation(
            fileSessionRecoveryCloseEpochs,
            fileSessionRecoveryQueues,
            replacedFileSessionId,
            createFileSession,
            async (supersededSession) => {
              if (supersededSession.id !== replacedFileSessionId) {
                suppressFileSessionRecoveryResult(
                  suppressedFileSessionIds,
                  supersededSession.id,
                  replacedFileSessionId,
                )
                bumpSessionRevision(
                  fileSessionEventRevisions,
                  supersededSession.id,
                )
                setData((current) => ({
                  ...current,
                  fileSessions: current.fileSessions.filter(
                    (session) => session.id !== supersededSession.id,
                  ),
                }))
                try {
                  const cleaned = await cleanupSuppressedFileSessionRecoveryResult(
                    suppressedFileSessionIds,
                    supersededSession.id,
                    replacedFileSessionId,
                    () => api.deleteFileSession(supersededSession.id),
                  )
                  if (cleaned) {
                    bumpSessionRevision(
                      fileSessionEventRevisions,
                      supersededSession.id,
                    )
                  }
                } catch (error) {
                  console.error('清理已被显式关闭覆盖的文件会话失败', {
                    fileSessionId: supersededSession.id,
                    error,
                  })
                  scheduleSuppressedFileSessionCleanup(
                    supersededSession.id,
                    replacedFileSessionId,
                  )
                  throw error
                }
              }
            },
            releaseFileSessionRecoveryEpoch,
          )
        : await createFileSession()
      adoptSuppressedFileSessionRecoveryResult(
        suppressedFileSessionIds,
        fileSession.id,
      )
      if (replacedFileSessionId && replacedFileSessionId !== fileSession.id) {
        bumpSessionRevision(fileSessionEventRevisions, replacedFileSessionId)
      }
      bumpSessionRevision(fileSessionEventRevisions, fileSession.id)
      setData((current) => ({
        ...current,
        fileSessions: replaceFileSessionSnapshot(
          current.fileSessions,
          fileSession,
          replacedFileSessionId,
        ),
      }))
      if (fileSession.source_session_id) {
        setFileSessionClosures((current) => {
          if (!current[fileSession.source_session_id as string]) {
            return current
          }
          const next = { ...current }
          delete next[fileSession.source_session_id as string]
          return next
        })
      }
      return fileSession
    },
    async closeFileSession(fileSessionId: string) {
      supersedeFileSessionRecoveryOperation(fileSessionId)
      const closingFileSession = fileSessions.find((session) => session.id === fileSessionId)
      const sourceSessionId = closingFileSession?.source_session_id ?? ''
      if (closingFileSession && sourceSessionId) {
        setFileSessionClosures((current) => ({
          ...current,
          [sourceSessionId]: {
            session: closingFileSession,
            phase: 'closing',
          },
        }))
      }
      bumpSessionRevision(fileSessionEventRevisions, fileSessionId)
      try {
        await api.deleteFileSession(fileSessionId)
      } catch (error) {
        if (!(error instanceof TermousApiError && error.code === 'SFTP_FILE_SESSION_NOT_FOUND')) {
          if (sourceSessionId) {
            setFileSessionClosures((current) => removeMatchingFileSessionClosure(
              current,
              sourceSessionId,
              fileSessionId,
            ))
          }
          throw error
        }
      }
      bumpSessionRevision(fileSessionEventRevisions, fileSessionId)
      if (closingFileSession && sourceSessionId) {
        setFileSessionClosures((current) => {
          const closure = current[sourceSessionId]
          if (!closure || closure.session.id !== fileSessionId) {
            return current
          }
          return {
            ...current,
            [sourceSessionId]: {
              session: closingFileSession,
              phase: 'closed',
            },
          }
        })
      }
      setData((current) => ({
        ...current,
        fileSessions: current.fileSessions.filter((session) => session.id !== fileSessionId),
      }))
    },
    async reconnectFileSession(fileSessionId: string) {
      const fileSession = await runQueuedFileSessionRecoveryOperation(
        fileSessionRecoveryCloseEpochs,
        fileSessionRecoveryQueues,
        fileSessionId,
        () => api.reconnectFileSession(fileSessionId),
        undefined,
        releaseFileSessionRecoveryEpoch,
      )
      adoptSuppressedFileSessionRecoveryResult(
        suppressedFileSessionIds,
        fileSession.id,
      )
      bumpSessionRevision(fileSessionEventRevisions, fileSession.id)
      setData((current) => ({
        ...current,
        fileSessions: upsertFileSessionSnapshot(current.fileSessions, fileSession),
      }))
      if (fileSession.source_session_id) {
        setFileSessionClosures((current) => removeMatchingFileSessionClosure(
          current,
          fileSession.source_session_id as string,
          fileSession.id,
        ))
      }
      return fileSession
    },
    supersedeFileSessionRecovery(fileSessionId: string) {
      supersedeFileSessionRecoveryOperation(fileSessionId)
    },
    updateFileSession(fileSession: FileSession) {
      if (suppressedFileSessionIds.has(fileSession.id)) {
        return
      }
      bumpSessionRevision(fileSessionEventRevisions, fileSession.id)
      setData((current) => {
        if (!current.fileSessions.some((session) => session.id === fileSession.id)) {
          return current
        }
        return {
          ...current,
          fileSessions: upsertFileSessionSnapshot(current.fileSessions, fileSession),
        }
      })
    },
  }
}
