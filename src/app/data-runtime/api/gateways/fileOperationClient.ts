import type { AppConfig } from '#common/contracts';
import type { FileOperationTask, RemoteTextSaveRequest } from '#entities/file';
import { TermousApiTransport } from '#shared/api';

export class FileOperationClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

createFileSessionTextReadOperation(fileSessionId: string, path: string, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/read`, {
      method: 'POST',
      body: { path },
      signal,
    })
  }

createFileSessionTextSaveOperation(fileSessionId: string, body: RemoteTextSaveRequest, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/save`, {
      method: 'POST',
      body,
      signal,
      timeoutMs: 90_000,
    })
  }

createFileSessionImageReadOperation(fileSessionId: string, path: string) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/image/read`, {
      method: 'POST',
      body: { path },
    })
  }

fileOperation(id: string) {
    return this.request<FileOperationTask>(`/api/v1/file-operations/${encodeURIComponent(id)}`)
  }

fileOperationResult<T>(id: string) {
    return this.request<T>(`/api/v1/file-operations/${encodeURIComponent(id)}/result`, {
      timeoutMs: 90_000,
    })
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
