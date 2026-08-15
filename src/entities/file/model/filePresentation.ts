import type { RemoteFileEntry, TransferStatus, TransferTask } from './types.ts'
import { normalizeRemotePosixPath } from '#shared/path'

export function transferDisplayName(task: TransferTask) {
  const currentFile = safeTransferLabel(task.current_file)
  if (currentFile) {
    return currentFile
  }

  const firstSource = task.source_paths.find((value) => safeTransferLabel(value) !== null)
  if (task.type.startsWith('upload')) {
    return safeTransferLabel(firstSource) ?? '-'
  }
  return safeRemotePathBase(firstSource) ?? safeRemotePathBase(task.target_path) ?? '-'
}

function safeTransferLabel(value?: string) {
  if (
    !value
    || value.trim().length === 0
    || hasControlCharacter(value)
  ) {
    return null
  }
  return value
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

function safeRemotePathBase(value?: string) {
  if (!value) {
    return null
  }
  const normalized = normalizeRemotePosixPath(value)
  if (normalized === null) {
    return null
  }
  if (normalized === '/') {
    return '/'
  }
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? null
}

export function formatSeconds(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return '-'
  }

  const totalSeconds = Math.ceil(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

export function fileSortValue(file: RemoteFileEntry) {
  return `${file.kind === 'directory' ? '0' : '1'}-${file.name.toLowerCase()}`
}

export function transferStatusClass(status: TransferStatus) {
  return `is-${status.replace(/_/g, '-')}`
}

export function transferProgress(task: TransferTask) {
  if (task.status === 'completed') {
    return 100
  }
  return Math.max(0, Math.min(100, Math.round(task.progress_percent || 0)))
}

export function isTransferRelatedToFileSession(
  task: TransferTask,
  fileSessionId: string,
) {
  return task.file_session_id === fileSessionId
    || task.source_file_session_id === fileSessionId
    || task.target_file_session_id === fileSessionId
}
