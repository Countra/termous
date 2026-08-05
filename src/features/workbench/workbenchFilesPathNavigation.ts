import type { FileSessionStatus, RemoteFileEntry } from '../../types/domain'
import { normalizeRemotePosixPath } from '#shared/path'

export interface WorkbenchFilesPathNavigationIntent {
  requestId: number
  sourceSessionId: string
  path: string
}

export interface WorkbenchFilesPathNavigationTarget {
  directoryPath: string
}

export type WorkbenchFilesPathNavigationAction = 'wait' | 'recover' | 'navigate' | 'fail'

export function resolveWorkbenchFilesPathNavigationAction(input: {
  fileSessionStatus?: FileSessionStatus
  recoveryCanRetry: boolean
  recoveryBusy: boolean
  recoveryAttempted: boolean
}): WorkbenchFilesPathNavigationAction {
  if (input.fileSessionStatus === 'connected') {
    return 'navigate'
  }
  if (input.recoveryAttempted) {
    return input.recoveryBusy ? 'wait' : 'fail'
  }
  if (input.recoveryCanRetry && !input.recoveryBusy) {
    return 'recover'
  }
  return 'wait'
}

export function resolveWorkbenchFilesPathNavigationTarget(
  entry: RemoteFileEntry,
): WorkbenchFilesPathNavigationTarget | null {
  const normalizedPath = normalizeRemotePosixPath(entry.path)
  if (!normalizedPath) {
    return null
  }
  if (entry.kind === 'directory') {
    return {
      directoryPath: normalizedPath,
    }
  }
  const segments = normalizedPath.split('/').filter(Boolean)
  segments.pop()
  return {
    directoryPath: segments.length > 0 ? `/${segments.join('/')}` : '/',
  }
}
