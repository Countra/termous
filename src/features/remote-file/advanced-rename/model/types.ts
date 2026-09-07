import type {
  AdvancedRenameExecutionResult,
  AdvancedRenamePreview,
  AdvancedRenameRule,
  AdvancedRenameVariableDefinition,
  FileOperationTask,
  FileRenamePreset,
  RemoteFileEntry,
} from '#entities/file'
import type { FileOperationGateway } from '../../model/fileOperationGateway'
import type { AdvancedRenameGateway } from './advancedRenameGateway'

export interface AdvancedRenameSourceSnapshot {
  fileSessionId: string
  connectionGeneration: number
  directory: string
  entries: RemoteFileEntry[]
}

export interface AdvancedRenameModalProps {
  api: AdvancedRenameGateway & FileOperationGateway
  open: boolean
  source: AdvancedRenameSourceSnapshot | null
  onClose: () => void
  onCompleted: (result: AdvancedRenameExecutionResult) => void | Promise<void>
  onDirectoryRefresh?: (result?: AdvancedRenameExecutionResult) => void | Promise<void>
}

export interface AdvancedRenameDraftState {
  selectedPresetId: string
  rules: AdvancedRenameRule[]
  variableDefinitions: AdvancedRenameVariableDefinition[]
  variables: Record<string, string>
  excludedPaths: Set<string>
  manualOverrides: Record<string, string>
}

export interface AdvancedRenameExecutionState {
  task: FileOperationTask | null
  result: AdvancedRenameExecutionResult | null
  error: string
  cancelling: boolean
}

export interface AdvancedRenamePresetState {
  items: FileRenamePreset[]
  loading: boolean
  saving: boolean
  error: string
}

export interface AdvancedRenamePreviewState {
  value: AdvancedRenamePreview | null
  loading: boolean
  error: string
  requestSequence: number
}
