export interface FilesBookmarkManagementIntent {
  requestId: number
  fileSessionId: string
}

export interface FilesBookmarkManagementRequest {
  requestId: number
  sourceSessionId: string
  hostId: string
}

interface FilesBookmarkManagementSession {
  id: string
  host_id?: string
  kind: string
  status: string
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
  sessions: readonly FilesBookmarkManagementSession[],
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
