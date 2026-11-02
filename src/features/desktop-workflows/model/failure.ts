import type { WorkflowFileErrorDetails } from '#common/contracts'

export interface WorkflowFailure { message: string; code?: string; status?: number; details?: WorkflowFileErrorDetails }

export function workflowFailure(error: unknown): WorkflowFailure {
  return { message: error instanceof Error ? error.message : 'Request failed',
    ...(error && typeof error === 'object' && 'code' in error ? { code: String(error.code) } : {}),
    ...(error && typeof error === 'object' && 'status' in error ? { status: Number(error.status) } : {}),
    ...(error && typeof error === 'object' && 'details' in error && error.details && typeof error.details === 'object' ? { details: error.details as WorkflowFileErrorDetails } : {}) }
}
