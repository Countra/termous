import type { RemoteResult } from './remote-control'

export interface SystemFileClipboardContext {
  sessionId: string
  generation: number
  subscriptionId: string
  controlGeneration: number
}
export interface SystemFileClipboardState {
  supported: boolean
  enabled: boolean
  publication_id?: string
  task_id?: string
  content_generation?: number
  files: { index: number; name: string; directory: boolean; size: number }[]
  error_code?: string
}
export interface SystemFileSelection {
  kind: 'files' | 'text' | 'same_session'
  sequence?: number
  grant?: { id: string; items: { name: string; kind: string; size: number }[] }
}
export interface DesktopFileBridge {
  configure: (context: SystemFileClipboardContext, enabled: boolean, focused: boolean, action?: 'set' | 'detach') => Promise<RemoteResult<SystemFileClipboardState>>
  importClipboard: (context: SystemFileClipboardContext) => Promise<RemoteResult<SystemFileSelection>>
  consumeDrop: (context: SystemFileClipboardContext) => Promise<RemoteResult<SystemFileSelection>>
  releaseSelection: (grantId: string) => Promise<RemoteResult<void>>
}
