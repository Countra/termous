import type { DetachedConnection } from './detached-window.ts'
import { isDetachedIdentity } from './detached-window.ts'

export const workflowExchangeChannels = {
  run: 'workflow-exchange:run', cancel: 'workflow-exchange:cancel', progress: 'workflow-exchange:progress',
  openDirectory: 'workflow-exchange:open-directory',
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
  location_id?: string
  error?: { code: string; message: string; status?: number; details?: WorkflowFileErrorDetails }
}
export interface WorkflowFileErrorDetails { field?: string; diagnostics?: { step_id?: string; field: string; code: string }[] }
export interface WorkflowExportLocationRequest { location_id: string; origin?: DetachedConnection }
export interface WorkflowFileBridge {
  run(request: WorkflowFileRequest): Promise<WorkflowFileResponse>
  openDirectory(request: WorkflowExportLocationRequest): Promise<WorkflowFileResponse>
  cancel(operationID: string): Promise<void>
  onProgress(listener: (progress: WorkflowFileProgress) => void): () => void
}
function isOrigin(value: unknown): boolean {
  return value === undefined || isDetachedIdentity(value) && typeof (value as DetachedConnection).generation === 'string'
    && /^[a-zA-Z0-9_-]{1,80}$/.test((value as DetachedConnection).generation)
    && Object.keys(value as object).every(key => ['module', 'instance', 'generation'].includes(key))
}
export function isWorkflowExportLocationRequest(value: unknown): value is WorkflowExportLocationRequest {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return Object.keys(r).every(key => ['location_id', 'origin'].includes(key))
    && typeof r.location_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.location_id) && isOrigin(r.origin)
}
export function isWorkflowFileRequest(value: unknown): value is WorkflowFileRequest {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  if (Object.keys(r).some(key => !['operation_id', 'origin', 'kind', 'script_id', 'version', 'layout'].includes(key))) return false
  if (typeof r.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.operation_id)) return false
  if (!isOrigin(r.origin)) return false
  if (r.kind === 'import') return r.script_id === undefined && r.version === undefined && r.layout === undefined
  return r.kind === 'export' && typeof r.script_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.script_id)
    && Number.isSafeInteger(r.version) && Number(r.version) > 0 && ['zip', 'directory', 'json'].includes(String(r.layout))
}
