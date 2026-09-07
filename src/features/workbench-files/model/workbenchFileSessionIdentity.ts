import type { FileSession, FileSessionClosureState } from '#entities/file'
import {
  selectCompanionSFTPFileAccessProfile,
  type FileAccessProfile,
} from '#entities/file-access-profile'
import type { Session } from '#entities/session'

export interface SourceSessionContext {
  hostId: string
  sshProfileId: string
  status: Session['status']
}

export function buildSourceSessionContexts(sessions: Session[]) {
  const contexts = new Map<string, SourceSessionContext>()
  for (const session of sessions) {
    if (session.kind !== 'ssh' || !session.host_id) {
      continue
    }
    contexts.set(session.id, {
      hostId: session.host_id,
      sshProfileId: session.ssh_profile_id ?? '',
      status: session.status,
    })
  }
  return contexts
}

export function selectWorkbenchCompanionFileProfile(
  profiles: FileAccessProfile[],
  session: Session | null,
) {
  if (session?.kind !== 'ssh' || !session.host_id || !session.ssh_profile_id) {
    return undefined
  }
  return selectWorkbenchCompanionFileProfileForSource(
    profiles,
    session.host_id,
    session.ssh_profile_id,
  )
}

export function selectWorkbenchCompanionFileProfileForSource(
  profiles: FileAccessProfile[],
  hostId: string,
  sshProfileId: string,
) {
  return selectCompanionSFTPFileAccessProfile(
    profiles,
    hostId,
    sshProfileId,
  )
}

export function isCurrentSourceSession(
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
  sshProfileId: string,
) {
  const source = contexts.get(sourceSessionId)
  return source?.status === 'connected'
    && source.hostId === hostId
    && source.sshProfileId === sshProfileId
}

export function canApplyCreatedFileSession(
  created: FileSession,
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
  fileAccessProfileId: string,
  sshProfileId: string,
) {
  return isCurrentSourceSession(contexts, sourceSessionId, hostId, sshProfileId)
    && created.source_session_id === sourceSessionId
    && created.host_id === hostId
    && created.file_access_profile_id === fileAccessProfileId
    && created.ssh_profile_id === sshProfileId
}

export function canUseSourceFileSession(
  contexts: Map<string, SourceSessionContext>,
  sourceSessionId: string,
  hostId: string,
  closingSourceSessionIds: ReadonlySet<string>,
  sshProfileId: string,
) {
  return !closingSourceSessionIds.has(sourceSessionId)
    && isCurrentSourceSession(contexts, sourceSessionId, hostId, sshProfileId)
}

export function fileSessionMatchesWorkbenchSource(
  session: FileSession | null | undefined,
  sourceSessionId: string,
  hostId: string,
  fileAccessProfileId: string,
  sshProfileId: string,
) {
  return Boolean(
    session
    && session.source_session_id === sourceSessionId
    && session.host_id === hostId
    && session.file_access_profile_id === fileAccessProfileId
    && session.ssh_profile_id === sshProfileId,
  )
}

export function selectWorkbenchFileSession(
  sessions: FileSession[],
  sourceSessionId: string,
  hostId: string,
  fileAccessProfileId: string,
  sshProfileId: string,
  fileSessionId = '',
) {
  return sessions.find((session) => (
    (!fileSessionId || session.id === fileSessionId)
    && fileSessionMatchesWorkbenchSource(
      session,
      sourceSessionId,
      hostId,
      fileAccessProfileId,
      sshProfileId,
    )
  ))
}

export function selectWorkbenchFileSessionClosure(
  closures: Readonly<Record<string, FileSessionClosureState>>,
  sourceSessionId: string,
  hostId: string,
  fileAccessProfileId: string,
  sshProfileId: string,
) {
  const closure = closures[sourceSessionId]
  return fileSessionMatchesWorkbenchSource(
    closure?.session,
    sourceSessionId,
    hostId,
    fileAccessProfileId,
    sshProfileId,
  ) ? closure : undefined
}

export function workbenchFileSessionKey(session: FileSession) {
  return [
    session.source_session_id ?? '',
    session.ssh_profile_id ?? '',
    session.file_access_profile_id ?? '',
    session.id,
    session.connection_generation ?? 0,
  ].join(':')
}
