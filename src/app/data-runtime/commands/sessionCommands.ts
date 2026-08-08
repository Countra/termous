import { TermousApiError } from '#shared/api'
import type { FileSession, FileSessionClosureState } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type {
  FileSessionCommandGateway,
  ForwardCommandGateway,
  SessionCommandGateway,
} from '../api/runtimeGatewayContracts'
import {
  bumpSessionRevision,
  markHostRecentlyConnected,
  sessionInventorySignature,
  upsertSession,
  type LoadMode,
} from '../model/appDataState'
import { shouldApplySessionInventoryResponse } from '../model/sessionInventoryState'
import type { LocalShell, Session } from '../model/sessionTypes'
import type { SetAppData, SetRuntimeState } from '../model/runtimeTypes'

interface SessionCommandDependencies {
  sessionApi: SessionCommandGateway
  fileSessionApi: Pick<FileSessionCommandGateway, 'deleteFileSession'>
  forwardApi: Pick<ForwardCommandGateway, 'stopForward'>
  sessions: Session[]
  fileSessions: FileSession[]
  forwards: ForwardInstance[]
  setData: SetAppData
  setActiveSession: SetRuntimeState<Session | null>
  setFileSessionClosures: SetRuntimeState<Record<string, FileSessionClosureState>>
  sessionEventRevisions: Map<string, number>
  fileSessionEventRevisions: Map<string, number>
  inventoryRequestRevisions: Map<string, number>
  inventoryEventRevisions: Map<string, number>
  inventoryStateSignatures: Map<string, string>
  load: (mode?: LoadMode) => Promise<void>
  supersedeFileSessionRecoveryOperation: (fileSessionId: string) => void
}

export function createSessionCommands({
  sessionApi,
  fileSessionApi,
  forwardApi,
  sessions,
  fileSessions,
  forwards,
  setData,
  setActiveSession,
  setFileSessionClosures,
  sessionEventRevisions,
  fileSessionEventRevisions,
  inventoryRequestRevisions,
  inventoryEventRevisions,
  inventoryStateSignatures,
  load,
  supersedeFileSessionRecoveryOperation,
}: SessionCommandDependencies) {
  return {
    async connect(hostId: string, cols = 120, rows = 32) {
      const session = await sessionApi.createSession(hostId, cols, rows)
      bumpSessionRevision(sessionEventRevisions, session.id)
      inventoryStateSignatures.set(session.id, sessionInventorySignature(session))
      setActiveSession(session)
      setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
      void load('silent')
      return session
    },
    async openLocalTerminal(shell: LocalShell, cols = 120, rows = 32) {
      const session = await sessionApi.createLocalSession(shell, cols, rows)
      bumpSessionRevision(sessionEventRevisions, session.id)
      inventoryStateSignatures.set(session.id, sessionInventorySignature(session))
      setActiveSession(session)
      setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
      void load('silent')
      return session
    },
    async disconnect(sessionId: string) {
      const linkedFileSessionIds = fileSessions
        .filter((session) => session.source_session_id === sessionId)
        .map((session) => session.id)
      try {
        await sessionApi.deleteSession(sessionId)
      } catch (error) {
        if (
          !(error instanceof TermousApiError)
          || error.status !== 404
          || error.code !== 'SESSION_NOT_FOUND'
        ) {
          throw error
        }
      }
      inventoryRequestRevisions.delete(sessionId)
      inventoryEventRevisions.delete(sessionId)
      inventoryStateSignatures.delete(sessionId)
      bumpSessionRevision(sessionEventRevisions, sessionId)
      linkedFileSessionIds.forEach((fileSessionId) => {
        supersedeFileSessionRecoveryOperation(fileSessionId)
        bumpSessionRevision(fileSessionEventRevisions, fileSessionId)
      })
      const fallbackSession = sessions.find((session) => session.id !== sessionId) ?? null
      setData((current) => ({
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
        fileSessions: current.fileSessions.filter((session) => session.source_session_id !== sessionId),
      }))
      setFileSessionClosures((current) => {
        if (!current[sessionId]) {
          return current
        }
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      setActiveSession((current) => (current?.id === sessionId ? fallbackSession : current))
      void load('silent')
    },
    async refreshSessionInventory(sessionId: string, force = false, signal?: AbortSignal) {
      const requestRevision = (inventoryRequestRevisions.get(sessionId) ?? 0) + 1
      inventoryRequestRevisions.set(sessionId, requestRevision)
      const baselineEventRevision = inventoryEventRevisions.get(sessionId) ?? 0
      let refreshed: Session
      try {
        refreshed = await sessionApi.refreshSessionInventory(sessionId, force, { signal })
      } catch (requestError) {
        if (baselineEventRevision !== (inventoryEventRevisions.get(sessionId) ?? 0)) {
          throw new TermousApiError('系统信息状态已由实时事件更新', 'REQUEST_SUPERSEDED', 0)
        }
        throw requestError
      }
      if (!shouldApplySessionInventoryResponse({
        sessionId,
        responseSessionId: refreshed.id,
        requestRevision,
        latestRequestRevision: inventoryRequestRevisions.get(sessionId) ?? 0,
        baselineEventRevision,
        latestEventRevision: inventoryEventRevisions.get(sessionId) ?? 0,
        aborted: Boolean(signal?.aborted),
      })) {
        return refreshed
      }
      bumpSessionRevision(sessionEventRevisions, sessionId)
      bumpSessionRevision(inventoryEventRevisions, sessionId)
      inventoryStateSignatures.set(sessionId, sessionInventorySignature(refreshed))
      setData((current) => ({ ...current, sessions: upsertSession(current.sessions, refreshed) }))
      setActiveSession((current) => (current?.id === refreshed.id ? refreshed : current))
      return refreshed
    },
    async disconnectAllConnections() {
      const sessionsToClose = sessions
      const fileSessionsToClose = fileSessions
      const forwardsToClose = forwards.filter((forward) => (
        forward.status === 'starting' ||
        forward.status === 'waiting_host_trust' ||
        forward.status === 'running' ||
        forward.status === 'stopping'
      ))
      fileSessionsToClose.forEach((fileSession) => {
        bumpSessionRevision(fileSessionEventRevisions, fileSession.id)
      })
      const results = await Promise.allSettled([
        ...sessionsToClose.map((session) => sessionApi.deleteSession(session.id)),
        ...fileSessionsToClose.map((fileSession) => (
          fileSessionApi.deleteFileSession(fileSession.id)
        )),
        ...forwardsToClose.map((forward) => forwardApi.stopForward(forward.id)),
      ])
      const failed = results.find((result) => result.status === 'rejected')
      if (failed && failed.status === 'rejected') {
        throw failed.reason
      }
      inventoryRequestRevisions.clear()
      sessionsToClose.forEach((session) => {
        bumpSessionRevision(sessionEventRevisions, session.id)
        inventoryEventRevisions.delete(session.id)
        inventoryStateSignatures.delete(session.id)
      })
      fileSessionsToClose.forEach((fileSession) => {
        bumpSessionRevision(fileSessionEventRevisions, fileSession.id)
      })
      setData((current) => ({ ...current, sessions: [], fileSessions: [], forwards: [] }))
      setActiveSession(null)
      void load('silent')
    },
    selectSession(sessionId: string) {
      const next = sessions.find((session) => session.id === sessionId)
      if (next) {
        setActiveSession(next)
      }
    },
    updateSession(sessionId: string, patch: Partial<Session>) {
      bumpSessionRevision(sessionEventRevisions, sessionId)
      const nextInventorySignature = sessionInventorySignature(patch)
      if (inventoryStateSignatures.get(sessionId) !== nextInventorySignature) {
        inventoryStateSignatures.set(sessionId, nextInventorySignature)
        bumpSessionRevision(inventoryEventRevisions, sessionId)
      }
      setActiveSession((current) => (current?.id === sessionId ? { ...current, ...patch } : current))
      setData((current) => ({
        ...current,
        ...markHostRecentlyConnected(
          current.hosts,
          current.sessions,
          sessionId,
          patch,
        ),
      }))
    },
  }
}
