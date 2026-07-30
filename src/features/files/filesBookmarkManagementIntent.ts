import type { Session } from '../../types/domain'

export interface FilesBookmarkManagementIntent {
  requestId: number
  fileSessionId: string
}

export interface FilesBookmarkManagementRequest {
  requestId: number
  sourceSessionId: string
  hostId: string
}

export function consumeFilesBookmarkManagementIntent(
  current: FilesBookmarkManagementIntent | null,
  requestId: number,
) {
  return current?.requestId === requestId ? null : current
}

export function canCommitFilesBookmarkManagementRequest(
  request: FilesBookmarkManagementRequest,
  currentRequest: FilesBookmarkManagementRequest | null,
  filesPageActive: boolean,
  sessions: readonly Session[],
) {
  if (
    currentRequest?.requestId !== request.requestId
    || !filesPageActive
  ) {
    return false
  }
  return sessions.some((session) => (
    session.id === request.sourceSessionId
    && session.host_id === request.hostId
    && session.kind === 'ssh'
    && session.status === 'connected'
  ))
}
