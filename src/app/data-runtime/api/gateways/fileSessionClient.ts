import type { AppConfig } from '#common/contracts';
import type { FileSession, OverwritePolicy, RemoteDirectoryListing, RemoteFileEntry, RemoteTextFile, RemoteTextSaveRequest, RemoteTextSaveResult } from '#entities/file';
import { TermousApiTransport } from '#shared/api';

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class FileSessionClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

fileSessions() {
    return this.request<FileSession[]>('/api/v1/file-sessions')
  }

createFileSession(hostId: string, sourceSessionId = '', initialPath = '') {
    const body: { host_id: string; source_session_id?: string; initial_path?: string } = { host_id: hostId }
    if (sourceSessionId) {
      body.source_session_id = sourceSessionId
    }
    if (initialPath) {
      body.initial_path = initialPath
    }
    return this.request<FileSession>('/api/v1/file-sessions', {
      method: 'POST',
      body,
    })
  }

getFileSession(id: string) {
    return this.request<FileSession>(`/api/v1/file-sessions/${encodeURIComponent(id)}`)
  }

deleteFileSession(id: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reconnectFileSession(id: string) {
    return this.request<FileSession>(`/api/v1/file-sessions/${encodeURIComponent(id)}/reconnect`, { method: 'POST' })
  }

fileSessionEventsUrl(id: string) {
    return this.websocketUrl(`/api/v1/file-sessions/${encodeURIComponent(id)}/events`)
  }

listFiles(hostId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files?${query.toString()}`)
  }

listFileSessionFiles(
    fileSessionId: string,
    path: string,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files?${query.toString()}`, {
      signal: options.signal,
    })
  }

statFileSessionFile(fileSessionId: string, path: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteFileEntry>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/stat?${query.toString()}`,
      { signal },
    )
  }

openFileSessionTextFile(fileSessionId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteTextFile>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text?${query.toString()}`, {
      timeoutMs: 90_000,
    })
  }

saveFileSessionTextFile(fileSessionId: string, body: RemoteTextSaveRequest) {
    return this.request<RemoteTextSaveResult>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text`, {
      method: 'PUT',
      body,
      timeoutMs: 90_000,
    })
  }

mkdirFileSessionFile(fileSessionId: string, path: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/mkdir`, {
      method: 'POST',
      body: { path },
    })
  }

renameFileSessionFile(fileSessionId: string, sourcePath: string, targetPath: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/rename`, {
      method: 'PATCH',
      body: { source_path: sourcePath, target_path: targetPath },
    })
  }

chmodFileSessionFile(fileSessionId: string, path: string, mode: string) {
    return this.request<RemoteFileEntry>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/permissions`, {
      method: 'PATCH',
      body: { path, mode },
    })
  }

deleteFileSessionFiles(fileSessionId: string, paths: string[], recursive = true) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files`, {
      method: 'DELETE',
      body: { paths, recursive },
    })
  }

copyFileSessionFiles(fileSessionId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/copy`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

moveFileSessionFiles(fileSessionId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/move`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

statFile(hostId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteFileEntry>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/stat?${query.toString()}`)
  }

mkdirFile(hostId: string, path: string) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/mkdir`, {
      method: 'POST',
      body: { path },
    })
  }

renameFile(hostId: string, sourcePath: string, targetPath: string) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/rename`, {
      method: 'PATCH',
      body: { source_path: sourcePath, target_path: targetPath },
    })
  }

deleteFiles(hostId: string, paths: string[], recursive = true) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files`, {
      method: 'DELETE',
      body: { paths, recursive },
    })
  }

copyFiles(hostId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/copy`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

moveFiles(hostId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/move`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }
}
