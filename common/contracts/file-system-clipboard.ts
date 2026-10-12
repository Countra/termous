import type { RemoteResult } from './remote-control'

export interface FileSystemClipboardRequest {
  file_session_id: string
  connection_generation: number
  operation_id: string
  paths: string[]
}

export interface FileSystemClipboardState {
  sequence?: number
  supported: boolean
  phase: 'idle' | 'unavailable' | 'preparing' | 'ready' | 'replaced' | 'stopped' | 'closed' | 'failed' | 'cleanup_pending'
  operation_id?: string
  publication_id?: string
  published?: boolean
  file_session_id?: string
  connection_generation?: number
  names: string[]
  count: number
  total_bytes: number
  downloaded_bytes?: number
  error_code?: string
  task?: { id: string; status: string; transferred_bytes: number; total_bytes: number; progress_percent: number; current_file?: string; cancellable: boolean; error_code?: string }
}

export interface FileClipboardImportRequest {
  file_session_id: string
  connection_generation: number
  sequence?: number
}

export interface FileClipboardImport {
  sequence: number
  grant?: {
    id: string
    source: 'clipboard'
    items: { id: string; name: string; kind: 'file' | 'directory'; size?: number }[]
    created_at: string
    expires_at: string
  }
}

export interface FileSystemClipboardBridge {
  importClipboard: (request: FileClipboardImportRequest) => Promise<RemoteResult<FileClipboardImport>>
  status: () => Promise<RemoteResult<FileSystemClipboardState>>
  copy: (request: FileSystemClipboardRequest) => Promise<RemoteResult<FileSystemClipboardState>>
  revoke: (publicationId: string) => Promise<RemoteResult<void>>
}
