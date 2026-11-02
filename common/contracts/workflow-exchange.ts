import type { DetachedConnection } from './detached-window.ts'
import { isDetachedIdentity } from './detached-window.ts'

export const workflowExchangeChannels = {
  run: 'workflow-exchange:run', cancel: 'workflow-exchange:cancel', progress: 'workflow-exchange:progress',
} as const
export type WorkflowExportLayout = 'zip' | 'directory' | 'json'
export interface WorkflowFileRequest {
  operation_id: string
  origin?: DetachedConnection
  kind: 'import' | 'export'
  script_id?: string
  version?: number
  layout?: WorkflowExportLayout
}
export interface WorkflowFileProgress {
  operation_id: string
  phase: 'selecting' | 'transferring' | 'validating' | 'publishing' | 'complete'
  transferred_bytes?: number
  total_bytes?: number
}
export interface WorkflowFileResponse {
  canceled?: boolean
  import_id?: string
  file_name?: string
  error?: { code: string; message: string; status?: number; details?: WorkflowFileErrorDetails }
}
export interface WorkflowFileErrorDetails { field?: string; diagnostics?: { step_id?: string; field: string; code: string }[] }
export interface WorkflowFileBridge {
  run(request: WorkflowFileRequest): Promise<WorkflowFileResponse>
  cancel(operationID: string): Promise<void>
  onProgress(listener: (progress: WorkflowFileProgress) => void): () => void
}
export function isWorkflowFileRequest(value: unknown): value is WorkflowFileRequest {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  if (Object.keys(r).some(key => !['operation_id', 'origin', 'kind', 'script_id', 'version', 'layout'].includes(key))) return false
  if (typeof r.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.operation_id)) return false
  if (r.origin !== undefined && (!isDetachedIdentity(r.origin) || typeof (r.origin as DetachedConnection).generation !== 'string'
    || !/^[a-zA-Z0-9_-]{1,80}$/.test((r.origin as DetachedConnection).generation)
    || Object.keys(r.origin as object).some(key => !['module', 'instance', 'generation'].includes(key)))) return false
  if (r.kind === 'import') return r.script_id === undefined && r.version === undefined && r.layout === undefined
  return r.kind === 'export' && typeof r.script_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.script_id)
    && Number.isSafeInteger(r.version) && Number(r.version) > 0 && ['zip', 'directory', 'json'].includes(String(r.layout))
}
