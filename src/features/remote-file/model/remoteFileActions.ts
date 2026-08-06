import type { RemoteFileEntry } from '#entities/file'

export type RemoteFileActionKey =
  | 'openFile'
  | 'download'
  | 'copy'
  | 'cut'
  | 'permissions'
  | 'rename'
  | 'delete'

export interface RemoteFileActionDescriptor {
  key: RemoteFileActionKey
  danger?: boolean
  dividerBefore?: boolean
}

export interface RemoteFileActionHandlers {
  openFile: (entry: RemoteFileEntry) => void
  download: (entry: RemoteFileEntry) => void
  copy: (entry: RemoteFileEntry) => void
  cut: (entry: RemoteFileEntry) => void
  permissions: (entry: RemoteFileEntry) => void
  rename: (entry: RemoteFileEntry) => void
  delete: (entry: RemoteFileEntry) => void
}

export function remoteFileActionDescriptors(entry: RemoteFileEntry): RemoteFileActionDescriptor[] {
  const actions: RemoteFileActionDescriptor[] = []
  if (entry.kind === 'file') {
    actions.push({ key: 'openFile' })
  }
  actions.push(
    { key: 'download' },
    { key: 'copy' },
    { key: 'cut' },
    { key: 'permissions' },
    { key: 'rename' },
    { key: 'delete', danger: true, dividerBefore: true },
  )
  return actions
}

export function runRemoteFileAction(
  entry: RemoteFileEntry,
  key: string,
  handlers: RemoteFileActionHandlers,
) {
  if (!isRemoteFileActionKey(key)) {
    return false
  }
  handlers[key](entry)
  return true
}

function isRemoteFileActionKey(value: string): value is RemoteFileActionKey {
  return value === 'openFile'
    || value === 'download'
    || value === 'copy'
    || value === 'cut'
    || value === 'permissions'
    || value === 'rename'
    || value === 'delete'
}
