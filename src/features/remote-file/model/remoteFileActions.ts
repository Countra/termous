import type { RemoteFileEntry } from '#entities/file'

export type RemoteFileActionKey =
  | 'openFile'
  | 'download'
  | 'sendToHost'
  | 'copy'
  | 'cut'
  | 'copyAbsolutePath'
  | 'permissions'
  | 'rename'
  | 'advancedRename'
  | 'delete'

export interface RemoteFileActionDescriptor {
  key: RemoteFileActionKey
  danger?: boolean
  dividerBefore?: boolean
}

export interface RemoteFileActionHandlers {
  openFile: (entry: RemoteFileEntry) => void
  download: (entry: RemoteFileEntry) => void
  sendToHost: (entry: RemoteFileEntry) => void
  copy: (entry: RemoteFileEntry) => void
  cut: (entry: RemoteFileEntry) => void
  copyAbsolutePath: (entry: RemoteFileEntry) => void
  permissions: (entry: RemoteFileEntry) => void
  rename: (entry: RemoteFileEntry) => void
  advancedRename: (entry: RemoteFileEntry) => void
  delete: (entry: RemoteFileEntry) => void
}

export interface RemoteFileActionSelectionSnapshot {
  paths: string[]
  entries: RemoteFileEntry[]
}

export function formatRemoteFilePathsForClipboard(paths: readonly string[]) {
  return paths.join('\n')
}

export function snapshotRemoteFileActionSelection(
  clickedEntry: RemoteFileEntry,
  selectedPaths: readonly string[],
  entries: readonly RemoteFileEntry[],
): RemoteFileActionSelectionSnapshot | null {
  const paths = selectedPaths.includes(clickedEntry.path)
    ? [...selectedPaths]
    : [clickedEntry.path]
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))
  const snapshots: RemoteFileEntry[] = []
  for (const path of paths) {
    const entry = entriesByPath.get(path)
    if (!entry) {
      return null
    }
    snapshots.push({ ...entry })
  }
  return { paths, entries: snapshots }
}

export function remoteFileActionDescriptors(entry: RemoteFileEntry): RemoteFileActionDescriptor[] {
  const actions: RemoteFileActionDescriptor[] = []
  if (entry.kind === 'file') {
    actions.push({ key: 'openFile' })
  }
  actions.push(
    { key: 'download' },
    { key: 'sendToHost' },
    { key: 'copy' },
    { key: 'cut' },
    { key: 'copyAbsolutePath' },
    { key: 'rename' },
  )
  if (entry.kind === 'file' || entry.kind === 'directory' || entry.kind === 'symlink') {
    actions.push({ key: 'advancedRename' })
  }
  actions.push({ key: 'permissions' })
  actions.push({ key: 'delete', danger: true, dividerBefore: true })
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
    || value === 'sendToHost'
    || value === 'copy'
    || value === 'cut'
    || value === 'copyAbsolutePath'
    || value === 'permissions'
    || value === 'rename'
    || value === 'advancedRename'
    || value === 'delete'
}
