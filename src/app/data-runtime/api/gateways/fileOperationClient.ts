import type { AppConfig } from '#common/contracts';
import type { FileOperationTask, OverwritePolicy, RemoteTextSaveRequest } from '#entities/file';
import { TermousApiTransport } from '#shared/api';
import { requireCanonicalRemotePath } from '#shared/path';

export class FileOperationClient extends TermousApiTransport {
  createFileSessionRenameOperation(id: string, generation: number, source: string, target: string) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(id)}/files/rename`, {
      method: 'PATCH', body: { source_path: source, target_path: target, async: true, expected_connection_generation: generation },
    }).then(validateFileOperationTask)
  }

  createFileSessionMoveOperation(id: string, generation: number, sources: string[], targetDir: string, policy: OverwritePolicy = 'rename') {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(id)}/files/move`, {
      method: 'POST', body: { source_paths: sources, target_dir: targetDir, overwrite_policy: policy, async: true, expected_connection_generation: generation },
    }).then(validateFileOperationTask)
  }
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

createFileSessionTextReadOperation(fileSessionId: string, path: string, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/read`, {
      method: 'POST',
      body: { path },
      signal,
    }).then(validateFileOperationTask)
  }

createFileSessionTextSaveOperation(fileSessionId: string, body: RemoteTextSaveRequest, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/save`, {
      method: 'POST',
      body,
      signal,
      timeoutMs: 90_000,
    }).then(validateFileOperationTask)
  }

createFileSessionImageReadOperation(fileSessionId: string, path: string) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/image/read`, {
      method: 'POST',
      body: { path },
    }).then(validateFileOperationTask)
  }

fileOperation(id: string) {
    return this.request<FileOperationTask>(`/api/v1/file-operations/${encodeURIComponent(id)}`)
      .then(validateFileOperationTask)
  }

fileOperationResult<T>(id: string) {
    return this.request<T>(`/api/v1/file-operations/${encodeURIComponent(id)}/result`, {
      timeoutMs: 90_000,
    }).then(validateFileOperationResult)
  }

fileOperationBlobResult(id: string) {
    return this.requestBlob(`/api/v1/file-operations/${encodeURIComponent(id)}/blob`, {
      timeoutMs: 90_000,
    })
  }

cancelFileOperation(id: string) {
    return this.request<void>(`/api/v1/file-operations/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

fileOperationEventsUrl(fileSessionId: string) {
    return this.websocketUrl(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/file-operations/events`)
  }
}

function validateFileOperationTask(task: FileOperationTask) {
  requireCanonicalRemotePath(task.path)
  return task
}

function validateFileOperationResult<T>(result: T): T {
  if (!result || typeof result !== 'object') {
    return result
  }
  const record = result as Record<string, unknown>
  if (isRecord(record.file) && isRecord(record.entry)) {
    validatePathField(record.file, 'path')
    validatePathField(record.entry, 'path')
    return result
  }
  if (typeof record.file_session_id === 'string') {
    validatePathField(record, 'path')
    return result
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (!isRecord(item)) {
        continue
      }
      if (typeof item.source_path === 'string') {
        validatePathField(item, 'source_path')
      }
      if (typeof item.target_path === 'string' && item.target_path !== '') {
        validatePathField(item, 'target_path')
      }
      if (typeof item.path === 'string') {
        validatePathField(item, 'path')
      }
    }
  }
  return result
}

function validatePathField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value === 'string') {
    requireCanonicalRemotePath(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
