import type { FileAccessCapability, FileSession } from './types.ts'

export function fileOperationCapabilities(session: Pick<FileSession, 'capabilities'> | null | undefined) {
  const has = (capability: FileAccessCapability) => Boolean(session && (!session.capabilities || session.capabilities.includes(capability)))
  return {
    read: has('content_read'),
    write: has('content_write'),
    create: has('entry_create'),
    receive: has('transfer_receive'),
    transfer: has('transfer'),
    remove: has('planned_delete'),
    mutate: has('entry_mutate'),
    rename: has('entry_mutate'),
    batchRename: has('batch_rename'),
    permissions: has('permission_edit'),
    search: has('name_search'),
  }
}
