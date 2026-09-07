export { buildRemoteFileActionMenu } from './ui/RemoteFileActionMenu.tsx'
export { RemotePermissionModal } from './ui/RemotePermissionModal.tsx'
export {
  formatRemoteFilePathsForClipboard,
  runRemoteFileAction,
  snapshotRemoteFileActionSelection,
} from './model/remoteFileActions.ts'
export type {
  RemoteFileActionHandlers,
  RemoteFileActionKey,
  RemoteFileActionSelectionSnapshot,
} from './model/remoteFileActions.ts'
export type { FileOperationGateway } from './model/fileOperationGateway.ts'
export type {
  AdvancedRenameSourceSnapshot,
} from './advanced-rename/model/types.ts'
export type {
  GlobalFileSearchAdvancedFilters,
  GlobalFileSearchOpenRequest,
  GlobalFileSearchReveal,
  GlobalFileSearchRevealResult,
  GlobalFileSearchRuntimeValue,
  GlobalFileSearchSource,
} from './global-search/model/types.ts'
export {
  GlobalFileSearchRuntimeProvider,
} from './global-search/runtime/GlobalFileSearchRuntimeProvider.tsx'
export { useGlobalFileSearchRuntime } from './global-search/runtime/useGlobalFileSearchRuntime.ts'
export {
  advancedRenameSourceLimit,
  isAdvancedRenameSourceSessionCurrent,
  validateAdvancedRenameSource,
} from './advanced-rename/model/advancedRenameModel.ts'

export const loadRemoteTextEditorModal = () => import('./ui/RemoteTextEditorModal.tsx')
  .then((module) => ({ default: module.RemoteTextEditorModal }))

export const loadRemoteImageViewerModal = () => import('./ui/RemoteImageViewerModal.tsx')
  .then((module) => ({ default: module.RemoteImageViewerModal }))

export const loadAdvancedRenameModal = () => import('./advanced-rename/ui/AdvancedRenameModal.tsx')
  .then((module) => ({ default: module.AdvancedRenameModal }))
