import type { Definition, Diagnostic, Script, Step, Target, ImageTarget } from './types'

export interface WorkflowExchangeImage extends Omit<ImageTarget, 'asset_id'> { path: string }
export interface WorkflowExchangeTarget extends Omit<Target, 'image'> { image?: WorkflowExchangeImage }
export interface WorkflowExchangeStep extends Omit<Step, 'image' | 'target' | 'end_target' | 'steps' | 'else'> {
 image?: WorkflowExchangeImage; target?: WorkflowExchangeTarget; end_target?: WorkflowExchangeTarget
 steps?: WorkflowExchangeStep[]; else?: WorkflowExchangeStep[]
}
export interface WorkflowExchangeDefinition extends Omit<Definition, 'steps'> { steps: WorkflowExchangeStep[] }
export interface WorkflowAssetDeclaration { path: string }
export interface WorkflowExchangeAsset { path: string; sha256: string; size: number; width: number; height: number }
export interface WorkflowManifest {
  format: 'termous.desktop-workflow'; format_version: 1
  name: string; description: string; tags: string[]; definition: WorkflowExchangeDefinition; assets: WorkflowAssetDeclaration[]
}
export type WorkflowImportCommit = { mode: 'create'; name?: string } | { mode: 'update'; script_id: string; expected_revision: number; name?: string }
export interface WorkflowImportReceipt { import_id: string; script: Script; created_at: string }
export interface WorkflowImportView {
  id: string; state: 'ready' | 'committing' | 'committed'; expires_at?: string
  manifest?: WorkflowManifest; assets?: WorkflowExchangeAsset[]; diagnostics?: Diagnostic[]; receipt?: WorkflowImportReceipt
}
export interface WorkflowExchangeGateway {
  inspect(id: string, signal?: AbortSignal): Promise<WorkflowImportView>
  commit(id: string, input: WorkflowImportCommit, signal?: AbortSignal): Promise<WorkflowImportReceipt>
  release(id: string): Promise<void>
  asset(id: string, hash: string, signal?: AbortSignal): Promise<Blob>
}
