import { isImageResourceReference, type ImageResourceReference } from '#common/contracts'
import { readDesktopBatch } from './receipt.ts'
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function validOpaqueIdentifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value) }
function validToolCallID(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) }

export interface DesktopTaskReceipt {
  tool_call_id: string
  execution_id: string
  revision: number
  result: Record<string, unknown> & { run: Record<string, unknown> }
  image?: ImageResourceReference
  evidence_error?: string
}
export interface DesktopTaskView {
  tool_call_id: string
  client_request_id: string
  generation: number
  execution_id?: string
  receipt?: DesktopTaskReceipt
  recorded_part_id?: string
}
export interface DesktopTaskSnapshot { cursor: string; tasks: DesktopTaskView[] }
export type ReadDesktopTasks = (cursor: string, waitMS: number, signal?: AbortSignal) => Promise<DesktopTaskSnapshot>

export function isDesktopTaskReceipt(value: unknown): value is DesktopTaskReceipt {
  if (!isRecord(value) || !validToolCallID(value.tool_call_id) || !validOpaqueIdentifier(value.execution_id)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !isRecord(value.result)
    || !isRecord(value.result.run) || !readDesktopBatch(value.result)) return false
  return value.result.run.id === value.execution_id && value.result.run.revision === value.revision
    && (value.image === undefined || isImageResourceReference(value.image))
    && (value.evidence_error === undefined || typeof value.evidence_error === 'string' && value.evidence_error.length <= 128)
}

export function isDesktopTaskSnapshot(value: unknown, generation: number): value is DesktopTaskSnapshot {
  return isRecord(value) && typeof value.cursor === 'string' && /^[a-f0-9]{64}$/u.test(value.cursor)
    && Array.isArray(value.tasks) && value.tasks.length <= 64 && value.tasks.every(task => isRecord(task)
      && task.generation === generation && validToolCallID(task.tool_call_id) && validOpaqueIdentifier(task.client_request_id)
      && (task.execution_id === undefined || validOpaqueIdentifier(task.execution_id))
      && (task.receipt === undefined || isDesktopTaskReceipt(task.receipt) && task.receipt.execution_id === task.execution_id))
}
