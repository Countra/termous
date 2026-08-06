export { buildRemoteFileActionMenu } from './ui/RemoteFileActionMenu.tsx'
export { RemotePermissionModal } from './ui/RemotePermissionModal.tsx'
export { runRemoteFileAction } from './model/remoteFileActions.ts'
export type { RemoteFileActionHandlers, RemoteFileActionKey } from './model/remoteFileActions.ts'
export type { FileOperationGateway } from './model/fileOperationGateway.ts'

export const loadRemoteTextEditorModal = () => import('./ui/RemoteTextEditorModal.tsx')
  .then((module) => ({ default: module.RemoteTextEditorModal }))

export const loadRemoteImageViewerModal = () => import('./ui/RemoteImageViewerModal.tsx')
  .then((module) => ({ default: module.RemoteImageViewerModal }))
