import type {
  AdvancedRenameExecuteInput,
  AdvancedRenamePlanInput,
  AdvancedRenamePreview,
  FileOperationTask,
  FileRenamePreset,
  FileRenamePresetInput,
} from '#entities/file'

export interface AdvancedRenameGateway {
  fileRenamePresets: () => Promise<FileRenamePreset[]>
  createFileRenamePreset: (input: FileRenamePresetInput) => Promise<FileRenamePreset>
  updateFileRenamePreset: (
    id: string,
    expectedUpdatedAt: string,
    input: FileRenamePresetInput,
  ) => Promise<FileRenamePreset>
  deleteFileRenamePreset: (id: string, expectedUpdatedAt: string) => Promise<void>
  previewFileSessionBatchRename: (
    fileSessionId: string,
    input: AdvancedRenamePlanInput,
    signal?: AbortSignal,
  ) => Promise<AdvancedRenamePreview>
  createFileSessionBatchRename: (
    fileSessionId: string,
    input: AdvancedRenameExecuteInput,
  ) => Promise<FileOperationTask>
}
