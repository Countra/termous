export interface DesktopDirectoryMapping {
  remembered: boolean
  id: string
  name: string
  label: string
  state: string
  target_path: string
  operation_id: string
  error_code?: string
  target_access_observed: boolean
  pending_io: number
}

export interface DesktopExchange {
  target_path?: string
  id: string
  kind: 'exchange' | 'clipboard'
  session_id: string
  resource_generation: number
  state: string
  name: string
  created_at: string
  expires_at?: string
  error_code?: string
}

export interface DesktopFileEntry {
  path: string
  name: string
  kind: 'file' | 'directory' | 'link' | 'other'
  size: number
  version: string
  modified_at: string
}

export interface DesktopFilesState {
  capabilities: { directory_mapping: boolean; exchange: boolean; file_clipboard: boolean; file_clipboard_read?: boolean; reason?: string }
  mappings: DesktopDirectoryMapping[]
  exchanges: DesktopExchange[]
}

export interface DesktopFileClipboard {
  published: boolean
  serving: boolean
  provided_bytes: number
  available: boolean
  reason?: string
  huge_files: boolean
  locking: boolean
  offered: boolean
  content_generation: number
  files: { index: number; name: string; directory: boolean; size: number }[]
  total_files: number
  operation?: { id: string; state: string; error_code?: string; completed_bytes: number; completed_files: number }
}

export interface DesktopClipboardQuery {
  generation: number
  subscription_id: string
  control_generation: number
  content_generation: number
  operation_id?: string
  offset?: number
  limit?: number
}
