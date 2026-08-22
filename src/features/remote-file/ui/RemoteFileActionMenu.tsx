import type { MenuProps } from 'antd'
import { ClipboardCopy, Copy, Download, Eye, ListRestart, Pencil, Scissors, Send, ShieldCheck, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type { RemoteFileEntry } from '#entities/file'
import {
  remoteFileActionDescriptors,
  type RemoteFileActionKey,
} from '../model/remoteFileActions'

const icons: Record<RemoteFileActionKey, ReactNode> = {
  openFile: <Eye size={14} />,
  download: <Download size={14} />,
  sendToHost: <Send size={14} />,
  copy: <Copy size={14} />,
  cut: <Scissors size={14} />,
  copyAbsolutePath: <ClipboardCopy size={14} />,
  permissions: <ShieldCheck size={14} />,
  rename: <Pencil size={14} />,
  advancedRename: <ListRestart size={14} />,
  delete: <Trash2 size={14} />,
}

const translationKeys: Record<RemoteFileActionKey, string> = {
  openFile: 'files.openFile',
  download: 'files.download',
  sendToHost: 'files.remoteCopy.action',
  copy: 'files.copy',
  cut: 'files.cut',
  copyAbsolutePath: 'files.copyAbsolutePath',
  permissions: 'files.editPermissions',
  rename: 'files.rename',
  advancedRename: 'files.advancedRename.action',
  delete: 'app.delete',
}

export function buildRemoteFileActionMenu(
  entry: RemoteFileEntry,
  t: TFunction,
): MenuProps['items'] {
  return remoteFileActionDescriptors(entry).flatMap((action) => {
    const item: NonNullable<MenuProps['items']>[number] = {
      key: action.key,
      danger: action.danger,
      icon: icons[action.key],
      label: t(translationKeys[action.key]),
    }
    return action.dividerBefore
      ? [{ type: 'divider' as const }, item]
      : [item]
  })
}
