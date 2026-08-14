import type { AppConfig } from '#common/contracts';
import type { LocalFileGrant, LocalGrantSource, OverwritePolicy, TransferTask } from '#entities/file';
import { TermousApiTransport } from '#shared/api';

export class TransferClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

createLocalFileGrant(source: LocalGrantSource, paths: string[]) {
    return this.request<LocalFileGrant>('/api/v1/local-file-grants', {
      method: 'POST',
      body: { source, paths },
    })
  }

  releaseLocalFileGrant(id: string) {
    return this.request<void>(`/api/v1/local-file-grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

transfers() {
    return this.request<TransferTask[]>('/api/v1/transfers')
  }

createUploadTransfer(
  hostId: string,
  localGrantId: string,
  remoteDir: string,
  overwritePolicy: OverwritePolicy = 'rename',
  overwriteItemIds: string[] = [],
) {
    return this.request<TransferTask>('/api/v1/transfers/upload', {
      method: 'POST',
      body: {
        host_id: hostId,
        local_grant_id: localGrantId,
        remote_dir: remoteDir,
        overwrite_policy: overwritePolicy,
        ...(overwriteItemIds.length > 0 ? { overwrite_item_ids: overwriteItemIds } : {}),
      },
    })
  }

createFileSessionUploadTransfer(
  fileSessionId: string,
  localGrantId: string,
  remoteDir: string,
  overwritePolicy: OverwritePolicy = 'rename',
  overwriteItemIds: string[] = [],
) {
    return this.request<TransferTask>('/api/v1/transfers/upload', {
      method: 'POST',
      body: {
        file_session_id: fileSessionId,
        local_grant_id: localGrantId,
        remote_dir: remoteDir,
        overwrite_policy: overwritePolicy,
        ...(overwriteItemIds.length > 0 ? { overwrite_item_ids: overwriteItemIds } : {}),
      },
    })
  }

createDownloadTransfer(hostId: string, remotePaths: string[], localDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<TransferTask>('/api/v1/transfers/download', {
      method: 'POST',
      body: {
        host_id: hostId,
        remote_paths: remotePaths,
        local_dir: localDir,
        overwrite_policy: overwritePolicy,
      },
    })
  }

createFileSessionDownloadTransfer(
    fileSessionId: string,
    remotePaths: string[],
    localDir: string,
    overwritePolicy: OverwritePolicy = 'rename',
    signal?: AbortSignal,
  ) {
    return this.request<TransferTask>('/api/v1/transfers/download', {
      method: 'POST',
      body: {
        file_session_id: fileSessionId,
        remote_paths: remotePaths,
        local_dir: localDir,
        overwrite_policy: overwritePolicy,
      },
      signal,
    })
  }

retryTransfer(id: string) {
    return this.request<TransferTask>(`/api/v1/transfers/${encodeURIComponent(id)}/retry`, { method: 'POST' })
  }

deleteTransfer(id: string) {
    return this.request<void>(`/api/v1/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

transferEventsUrl() {
    return this.websocketUrl('/api/v1/transfers/events')
  }
}
