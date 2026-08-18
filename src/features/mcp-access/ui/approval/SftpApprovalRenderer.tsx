import {
  FileDown,
  FilePenLine,
  FileUp,
  FolderInput,
  FolderPlus,
  PencilLine,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { formatBytes } from '#shared/format'
import { ApprovalPaths } from './ApprovalDetailFields'
import styles from '../McpApprovalCoordinator.module.scss'

export function SftpApprovalRenderer({ operation }: { operation: McpApprovalOperation }) {
  const { t } = useTranslation()
  const Icon = sftpActionIcons[operation.action] ?? Wrench
  const actionKey = sftpActionKeys[operation.action] ?? 'settings.mcp.approval.sftpAction.other'
  const sourceHost = operation.host_name || operation.file_session_id
  const targetHost = operation.target_host_name || operation.target_file_session_id
  const remotePathsLabel = operation.action === 'save_text' || operation.action === 'chmod'
    ? 'settings.mcp.approval.remotePath'
    : 'settings.mcp.approval.remotePaths'

  return (
    <div className={styles.operation}>
      <div className={styles['operation-title']}>
        <Icon size={16} aria-hidden="true" />
        <strong>{t(actionKey)}</strong>
      </div>

      {sourceHost || targetHost ? (
        <div className={styles['host-route']}>
          {sourceHost ? <span>{sourceHost}</span> : null}
          {sourceHost && targetHost ? <span aria-hidden="true">→</span> : null}
          {targetHost ? <span>{targetHost}</span> : null}
        </div>
      ) : null}

      <ApprovalPaths label={t(remotePathsLabel)} paths={operation.remote_paths} />
      <ApprovalPaths label={t('settings.mcp.approval.remoteTarget')} paths={toPathList(operation.remote_target)} />
      <ApprovalPaths label={t('settings.mcp.approval.localPaths')} paths={operation.local_paths} />
      <ApprovalPaths label={t('settings.mcp.approval.localTarget')} paths={toPathList(operation.local_target)} />

      {operation.overwrite_policy || operation.mode || operation.item_count !== undefined || operation.total_bytes !== undefined ? (
        <div className={styles['operation-meta']}>
          {operation.overwrite_policy ? (
            <span>
              {t('settings.mcp.approval.overwritePolicy')}
              <strong>{t(`settings.mcp.approval.overwrite.${operation.overwrite_policy}`)}</strong>
            </span>
          ) : null}
          {operation.mode ? (
            <span>
              {t('settings.mcp.approval.mode')}
              <strong>{operation.mode}</strong>
            </span>
          ) : null}
          {operation.item_count !== undefined ? (
            <span>
              {t('settings.mcp.approval.itemCount')}
              <strong>{operation.item_count}</strong>
            </span>
          ) : null}
          {operation.total_bytes !== undefined ? (
            <span>
              {t('settings.mcp.approval.totalBytes')}
              <strong>{formatBytes(operation.total_bytes)}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const sftpActionKeys: Record<string, string> = {
  save_text: 'settings.mcp.approval.sftpAction.saveText',
  mkdir: 'settings.mcp.approval.sftpAction.mkdir',
  rename: 'settings.mcp.approval.sftpAction.rename',
  chmod: 'settings.mcp.approval.sftpAction.chmod',
  upload: 'settings.mcp.approval.sftpAction.upload',
  download: 'settings.mcp.approval.sftpAction.download',
  remote_copy: 'settings.mcp.approval.sftpAction.remoteCopy',
}

const sftpActionIcons: Record<string, LucideIcon> = {
  save_text: FilePenLine,
  mkdir: FolderPlus,
  rename: PencilLine,
  chmod: ShieldCheck,
  upload: FileUp,
  download: FileDown,
  remote_copy: FolderInput,
}

function toPathList(path?: string) {
  return path ? [path] : []
}
