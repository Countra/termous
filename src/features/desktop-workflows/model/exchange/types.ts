import type { WorkflowExportLayout, WorkflowFileProgress } from '#common/contracts'
import type { Script, Version, WorkflowImportReceipt, WorkflowImportView } from '#entities/desktop-workflow'
import type { WorkflowFailure } from '../failure'

export type ExchangeCommand =
  | { kind: 'import' | 'cancel' | 'close' }
  | { kind: 'target'; id?: string }
  | { kind: 'name'; name: string }
  | { kind: 'commit' }
  | { kind: 'export'; version?: number; layout: WorkflowExportLayout }
export interface ExchangeState {
  available: boolean; busy: boolean; progress?: WorkflowFileProgress
  preview?: WorkflowImportView; name?: string; target?: { script: Script; version: Version }
  error?: WorkflowFailure; receipt?: WorkflowImportReceipt; exported?: string; conflict?: boolean; uncertain?: boolean
}
